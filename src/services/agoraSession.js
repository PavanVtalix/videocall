import AgoraRTC from "agora-rtc-sdk-ng";
import AgoraRTM from "agora-rtm-sdk";
import VirtualBackgroundExtension from "agora-extension-virtual-background";
import virtualBackgroundImageUrl from "../assets/background-img-2.png";

const virtualBackgroundExtension = new VirtualBackgroundExtension();
const virtualBackgroundSupported = virtualBackgroundExtension.checkCompatibility();

if (virtualBackgroundSupported) {
  AgoraRTC.registerExtensions([virtualBackgroundExtension]);
}

let virtualBackgroundImagePromise = null;

function loadVirtualBackgroundImage() {
  if (!virtualBackgroundImagePromise) {
    virtualBackgroundImagePromise = new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Unable to load virtual background image"));
      image.src = virtualBackgroundImageUrl;
    });
  }

  return virtualBackgroundImagePromise;
}

async function getVirtualBackgroundOptions(mode) {
  if (mode === "blur") {
    return { type: "blur", blurDegree: 2 };
  }

  if (mode === "image") {
    const image = await loadVirtualBackgroundImage();
    return { type: "img", source: image };
  }

  if (mode === "color") {
    return { type: "color", color: "#ffffff" };
  }

  return { type: "none" };
}

function safeParseMessage(text) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function clearContainer(element) {
  if (element) {
    element.innerHTML = "";
  }
}

function sendChannelMessage(channel, payload) {
  return channel.sendMessage({ text: JSON.stringify(payload) });
}

export async function createAgoraSession({
  appId,
  channelName,
  rtcToken,
  rtcUid,
  rtmToken,
  rtmUserId,
  localContainer,
  remoteContainer,
  onStatusChange,
  onRemoteConnectedChange,
  onRemoteVideoStateChange,
  onRemoteAudioStateChange,
  onChatMessage,
  onMediaState,
}) {
  const rtcClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
  const rtmClient = AgoraRTM.createInstance(appId);
  const rtmChannel = rtmClient.createChannel(channelName);
  let virtualBackgroundProcessor = null;
  let localAudioTrack = null;
  let localVideoTrack = null;

  rtcClient.on("connection-state-change", (currentState) => {
    if (currentState === "DISCONNECTED") onStatusChange?.("Disconnected");
    if (currentState === "CONNECTING") onStatusChange?.("Connecting");
    if (currentState === "CONNECTED") onStatusChange?.("Live");
    if (currentState === "RECONNECTING") onStatusChange?.("Reconnecting");
  });

  rtcClient.on("user-published", async (user, mediaType) => {
    await rtcClient.subscribe(user, mediaType);
    onRemoteConnectedChange?.(true);

    if (mediaType === "video" && user.videoTrack) {
      clearContainer(remoteContainer);
      user.videoTrack.play(remoteContainer);
      onRemoteVideoStateChange?.(false);
    }

    if (mediaType === "audio" && user.audioTrack) {
      user.audioTrack.play();
      onRemoteAudioStateChange?.(false);
    }
  });

  rtcClient.on("user-unpublished", (user, mediaType) => {
    if (mediaType === "video") {
      user.videoTrack?.stop();
      clearContainer(remoteContainer);
      onRemoteVideoStateChange?.(true);
    }

    if (mediaType === "audio") {
      user.audioTrack?.stop();
      onRemoteAudioStateChange?.(true);
    }
  });

  rtcClient.on("user-left", (user) => {
    user.videoTrack?.stop();
    user.audioTrack?.stop();
    clearContainer(remoteContainer);
    onRemoteConnectedChange?.(false);
    onRemoteVideoStateChange?.(true);
    onRemoteAudioStateChange?.(true);
    onStatusChange?.("Waiting");
  });

  rtmChannel.on("ChannelMessage", ({ text }, memberId) => {
    const payload = safeParseMessage(text);
    if (!payload || memberId === rtmUserId) {
      return;
    }

    if (payload.kind === "chat") {
      onChatMessage?.(payload);
      return;
    }

    if (payload.kind === "media-state") {
      onMediaState?.(payload);
    }
  });

  await rtmClient.login({ uid: rtmUserId, token: rtmToken });
  await rtmChannel.join();

  await rtcClient.join(appId, channelName, rtcToken, rtcUid);
  const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
    {
      AEC: true,
      ANS: true,
      AGC: true,
      encoderConfig: "speech_standard",
    },
    {
      encoderConfig: "480p_1",
      optimizationMode: "motion",
    }
  );

  localAudioTrack = audioTrack;
  localVideoTrack = videoTrack;

  if (virtualBackgroundSupported) {
    virtualBackgroundProcessor = virtualBackgroundExtension.createProcessor();
    await virtualBackgroundProcessor.init();
    localVideoTrack.pipe(virtualBackgroundProcessor).pipe(localVideoTrack.processorDestination);
    await virtualBackgroundProcessor.disable();
  }

  localVideoTrack.play(localContainer);
  await rtcClient.publish([localAudioTrack, localVideoTrack]);
  onStatusChange?.("Waiting");

  return {
    isVirtualBackgroundSupported() {
      return virtualBackgroundSupported;
    },
    async leave() {
      try {
        await rtcClient.unpublish([localAudioTrack, localVideoTrack].filter(Boolean));
      } catch (_error) {}

      try {
        localVideoTrack?.unpipe();
      } catch (_error) {}

      try {
        await virtualBackgroundProcessor?.release();
      } catch (_error) {}

      localAudioTrack?.stop();
      localAudioTrack?.close();
      localVideoTrack?.stop();
      localVideoTrack?.close();
      clearContainer(localContainer);
      clearContainer(remoteContainer);

      try {
        await rtmChannel.leave();
      } catch (_error) {}

      try {
        await rtmClient.logout();
      } catch (_error) {}

      await rtcClient.leave();
    },
    async setVirtualBackgroundMode(mode) {
      if (!virtualBackgroundProcessor || !virtualBackgroundSupported) {
        return;
      }

      if (mode === "off") {
        await virtualBackgroundProcessor.disable();
        return;
      }

      const options = await getVirtualBackgroundOptions(mode);
      await virtualBackgroundProcessor.setOptions(options);
      await virtualBackgroundProcessor.enable();
    },
    async setAudioEnabled(enabled) {
      if (!localAudioTrack) {
        return;
      }

      await localAudioTrack.setEnabled(enabled);
      await sendChannelMessage(rtmChannel, {
        kind: "media-state",
        type: "audio",
        enabled,
        muted: !enabled,
        timestamp: new Date().toISOString(),
      });
    },
    async setVideoEnabled(enabled) {
      if (!localVideoTrack) {
        return;
      }

      await localVideoTrack.setEnabled(enabled);
      if (enabled) {
        localVideoTrack.play(localContainer);
      } else {
        localVideoTrack.stop();
      }

      await sendChannelMessage(rtmChannel, {
        kind: "media-state",
        type: "video",
        enabled,
        videoOff: !enabled,
        timestamp: new Date().toISOString(),
      });
    },
    async sendChatMessage(payload) {
      await sendChannelMessage(rtmChannel, payload);
    },
  };
}
