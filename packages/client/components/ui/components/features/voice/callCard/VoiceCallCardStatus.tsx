import { Trans } from "@lingui/solid/macro";
import {
  createEffect,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { styled } from "styled-system/jsx";

import { ConnectionQuality, Track } from "livekit-client";

import { useVoice } from "@revolt/rtc";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

export function VoiceCallCardStatus(props: { pip?: boolean }) {
  const voice = useVoice();

  const [quality, setQuality] = createSignal<ConnectionQuality>(
    ConnectionQuality.Unknown,
  );
  const [ping, setPing] = createSignal<number>();

  /**
   * LiveKit fornece uma estimativa de qualidade que também considera
   * fatores além da latência pura, como perda e estabilidade.
   */
  createEffect(() => {
    const room = voice.room();

    if (!room) {
      setQuality(ConnectionQuality.Unknown);
      return;
    }

    const participant = room.localParticipant;

    setQuality(participant.connectionQuality);

    const onQualityChanged = (next: ConnectionQuality) => {
      setQuality(next);
    };

    participant.on("connectionQualityChanged", onQualityChanged);

    onCleanup(() => {
      participant.off("connectionQualityChanged", onQualityChanged);
    });
  });

  /**
   * Busca o RTT WebRTC real.
   *
   * Prioriza o microfone. Se o browser não fornecer RTT nele,
   * tenta screen share e câmera.
   */
  createEffect(() => {
    const room = voice.room();

    if (!room) {
      setPing();
      return;
    }

    let disposed = false;

    const updatePing = async () => {
      if (voice.state() !== "CONNECTED") {
        if (!disposed) setPing();
        return;
      }

      try {
        let roundTripTime: number | undefined;

        const microphone = voice.getMicrophoneTrack()?.audioTrack;

        if (microphone) {
          /*
           * LocalAudioTrack.getSenderStats() procura RTT no outbound-rtp,
           * mas Chromium normalmente o disponibiliza no remote-inbound-rtp.
           * Usamos o RTCStatsReport bruto para obter o RTT também em voz pura.
           */
          const report = await microphone.getRTCStatsReport();

          if (report) {
            report.forEach((rawStat) => {
              if (roundTripTime !== undefined) return;

              const stat = rawStat as RTCStats & {
                roundTripTime?: number;
              };

              if (
                stat.type === "remote-inbound-rtp" &&
                typeof stat.roundTripTime === "number" &&
                Number.isFinite(stat.roundTripTime)
              ) {
                roundTripTime = stat.roundTripTime;
              }
            });

            /*
             * Fallback para o RTT do par ICE selecionado.
             */
            if (roundTripTime === undefined) {
              report.forEach((rawStat) => {
                if (roundTripTime !== undefined) return;

                const stat = rawStat as RTCStats & {
                  currentRoundTripTime?: number;
                  nominated?: boolean;
                  selected?: boolean;
                };

                if (
                  stat.type === "candidate-pair" &&
                  (stat.nominated === true || stat.selected === true) &&
                  typeof stat.currentRoundTripTime === "number" &&
                  Number.isFinite(stat.currentRoundTripTime)
                ) {
                  roundTripTime = stat.currentRoundTripTime;
                }
              });
            }
          }

          /*
           * Último fallback para a API simplificada do LiveKit.
           */
          if (roundTripTime === undefined) {
            const stats = await microphone.getSenderStats();

            if (
              typeof stats?.roundTripTime === "number" &&
              Number.isFinite(stats.roundTripTime)
            ) {
              roundTripTime = stats.roundTripTime;
            }
          }
        }

        if (roundTripTime === undefined) {
          for (const source of [
            Track.Source.ScreenShare,
            Track.Source.Camera,
          ]) {
            const videoTrack =
              room.localParticipant.getTrackPublication(source)?.videoTrack;

            if (!videoTrack) continue;

            const stats = await videoTrack.getSenderStats();

            const withRtt = stats.find(
              (stat) =>
                typeof stat.roundTripTime === "number" &&
                Number.isFinite(stat.roundTripTime),
            );

            if (withRtt?.roundTripTime !== undefined) {
              roundTripTime = withRtt.roundTripTime;
              break;
            }
          }
        }

        if (disposed) return;

        setPing(
          roundTripTime === undefined
            ? undefined
            : Math.max(0, Math.round(roundTripTime * 1000)),
        );
      } catch {
        if (!disposed) setPing();
      }
    };

    void updatePing();

    const timer = window.setInterval(() => {
      void updatePing();
    }, 2000);

    onCleanup(() => {
      disposed = true;
      window.clearInterval(timer);
    });
  });

  const bars = () => {
    switch (quality()) {
      case ConnectionQuality.Excellent:
        return 4;
      case ConnectionQuality.Good:
        return 3;
      case ConnectionQuality.Poor:
        return 1;
      case ConnectionQuality.Lost:
        return 0;
      default:
        return 0;
    }
  };

  const symbol = () => {
    switch (voice.state()) {
      case "CONNECTED":
      case "CONNECTING":
      case "RECONNECTING":
        return "wifi_tethering";
      case "DISCONNECTED":
        return "wifi_tethering_error";
      default:
        return "";
    }
  };

  const text = () => {
    switch (voice.state()) {
      case "CONNECTING":
        return <Trans>Connecting</Trans>;
      case "DISCONNECTED":
        return <Trans>Disconnected</Trans>;
      case "RECONNECTING":
        return <Trans>Reconnecting</Trans>;
      default:
        return null;
    }
  };

  const title = () => {
    if (voice.state() !== "CONNECTED") return undefined;

    const pingText =
      ping() === undefined
        ? "Ping indisponível"
        : `Ping: ${ping()} ms`;

    return `${pingText} · Qualidade: ${quality()}`;
  };

  return (
    <Status
      status={voice.state()}
      pip={props.pip}
      title={title()}
    >
      <Show
        when={voice.state() === "CONNECTED"}
        fallback={
          <>
            <Symbol>{symbol()}</Symbol>
            <ConnectionText>{text()}</ConnectionText>
          </>
        }
      >
        <SignalBars aria-hidden="true">
          <SignalBar active={bars() >= 1} />
          <SignalBar active={bars() >= 2} />
          <SignalBar active={bars() >= 3} />
          <SignalBar active={bars() >= 4} />
        </SignalBars>

        <PingText>
          {ping() === undefined ? "— ms" : `${ping()} ms`}
        </PingText>
      </Show>
    </Status>
  );
}

const SignalBars = styled("div", {
  base: {
    height: "14px",
    display: "flex",
    alignItems: "flex-end",
    gap: "2px",

    "& span:nth-child(1)": {
      height: "4px",
    },

    "& span:nth-child(2)": {
      height: "7px",
    },

    "& span:nth-child(3)": {
      height: "10px",
    },

    "& span:nth-child(4)": {
      height: "14px",
    },
  },
});

const SignalBar = styled("span", {
  base: {
    width: "3px",
    borderRadius: "1px",
    background: "currentColor",
    opacity: 0.2,
    transition: "opacity 0.2s ease",
  },

  variants: {
    active: {
      true: {
        opacity: 1,
      },
    },
  },
});

const PingText = styled("span", {
  base: {
    paddingLeft: "var(--gap-md)",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  },
});

const ConnectionText = styled("div", {
  base: {
    paddingLeft: "var(--gap-md)",
  },
});

const Status = styled("div", {
  base: {
    flexShrink: 0,

    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },

  variants: {
    status: {
      READY: {},
      CONNECTED: {
        color: "var(--md-sys-color-primary)",
      },
      CONNECTING: {
        color: "var(--md-sys-color-outline)",
      },
      DISCONNECTED: {
        color: "var(--md-sys-color-outline)",
      },
      RECONNECTING: {
        color: "var(--md-sys-color-outline)",
      },
    },

    pip: {
      true: {
        position: "absolute",
        left: "var(--gap-md)",
        top: "var(--gap-md)",
      },
    },
  },
});
