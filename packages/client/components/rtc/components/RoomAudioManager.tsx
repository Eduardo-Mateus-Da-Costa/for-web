import { createEffect, createMemo, onCleanup } from "solid-js";
import { AudioTrack, useTracks } from "solid-livekit-components";

import { getTrackReferenceId, isLocal } from "@livekit/components-core";
import { Key } from "@solid-primitives/keyed";
import { RemoteTrackPublication, Track } from "livekit-client";

import { useState } from "@revolt/state";

import { useVoice } from "../state";

export function RoomAudioManager() {
  const voice = useVoice();
  const state = useState();

  /**
   * Desktop integration: expose the exact same ScreenShare volume/mute
   * state used by UserContextMenu and RoomAudioManager.
   *
   * This is deliberately tiny: the desktop fullscreen overlay should not
   * guess which HTMLAudioElement belongs to a participant. It simply calls
   * the same Voice store methods as the normal Stoat slider.
   */
  const desktopWindow = window as typeof window & {
    __duducdiScreenShareAudio?: {
      getVolume(userId: string): number;
      setVolume(userId: string, volume: number): void;
      getMuted(userId: string): boolean;
      setMuted(userId: string, muted: boolean): void;
    };
  };

  const desktopScreenShareAudio = {
    getVolume: (userId: string) =>
      state.voice.getScreenShareVolume(userId),
    setVolume: (userId: string, volume: number) =>
      state.voice.setScreenShareVolume(userId, volume),
    getMuted: (userId: string) =>
      state.voice.getScreenShareMuted(userId),
    setMuted: (userId: string, muted: boolean) =>
      state.voice.setScreenShareMuted(userId, muted),
  };

  desktopWindow.__duducdiScreenShareAudio =
    desktopScreenShareAudio;

  onCleanup(() => {
    if (
      desktopWindow.__duducdiScreenShareAudio ===
      desktopScreenShareAudio
    ) {
      delete desktopWindow.__duducdiScreenShareAudio;
    }
  });

  const tracks = useTracks(
    [
      Track.Source.Microphone,
      Track.Source.ScreenShareAudio,
      Track.Source.Unknown,
    ],
    {
      updateOnlyOn: [],
      onlySubscribed: false,
    },
  );

  const filteredTracks = createMemo(() =>
    tracks().filter(
      (track) =>
        !isLocal(track.participant) &&
        track.publication.kind === Track.Kind.Audio,
    ),
  );

  createEffect(() => {
    const tracks = filteredTracks();
    console.info("[rtc] filtered tracks", filteredTracks());
    for (const track of tracks) {
      (track.publication as RemoteTrackPublication).setSubscribed(true);
      console.info(track.publication);
    }
  });

  return (
    <div style={{ display: "none" }}>
      <Key each={filteredTracks()} by={(item) => getTrackReferenceId(item)}>
        {(track) => (
          <AudioTrack
            trackRef={track()}
            volume={
              state.voice.outputVolume *
              (track().source === Track.Source.ScreenShareAudio
                ? state.voice.getScreenShareVolume(track().participant.identity)
                : state.voice.getUserVolume(track().participant.identity))
            }
            muted={
              (track().source === Track.Source.ScreenShareAudio
                ? state.voice.getScreenShareMuted(track().participant.identity)
                : state.voice.getUserMuted(track().participant.identity)) ||
              voice.deafen()
            }
            enableBoosting
          />
        )}
      </Key>
    </div>
  );
}
