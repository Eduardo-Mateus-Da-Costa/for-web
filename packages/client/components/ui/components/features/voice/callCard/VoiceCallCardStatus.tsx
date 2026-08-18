import { Trans } from "@lingui/solid/macro";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { styled } from "styled-system/jsx";

import { ConnectionQuality } from "livekit-client";

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
   * Usa o RTT do canal de sinalização do próprio LiveKit.
   *
   * SignalClient.rtt já é calculado pelo SDK em MILISSEGUNDOS a partir
   * do ping/pong do WebSocket de sinalização. Portanto não multiplicamos
   * por 1000.
   *
   * Isso representa melhor o "ping até o servidor" que queremos exibir
   * do que os RTTs do RTCStatsReport observados neste ambiente.
   */
  createEffect(() => {
    const room = voice.room();
    const connectionState = voice.state();

    if (!room || connectionState !== "CONNECTED") {
      setPing();
      return;
    }

    setPing();

    let disposed = false;

    const updatePing = () => {
      if (disposed) return;

      if (voice.state() !== "CONNECTED") {
        setPing();
        return;
      }

      const signalRtt = room.engine?.client?.rtt;

      if (
        typeof signalRtt === "number" &&
        Number.isFinite(signalRtt) &&
        signalRtt > 0
      ) {
        setPing(Math.round(signalRtt));
      }
    };

    updatePing();

    /*
     * O SignalClient atualiza o RTT quando recebe pong do servidor.
     * Aqui apenas refletimos o valor mais recente na UI.
     */
    const timer = window.setInterval(updatePing, 1000);

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
      ping() === undefined ? "Ping indisponível" : `Ping: ${ping()} ms`;

    return `${pingText} · Qualidade: ${quality()}`;
  };

  return (
    <Status status={voice.state()} pip={props.pip} title={title()}>
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

        <PingText>{ping() === undefined ? "— ms" : `${ping()} ms`}</PingText>
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
