import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Controls from "../components/Controls";
import ChatDrawer from "../components/ChatDrawer";
import CallFeedbackModal from "../components/CallFeedbackModal";
import CallNoticeModal from "../components/CallNoticeModal";
import Timer from "../components/Timer";
import { createAgoraSession } from "../services/agoraSession";
import micOn from "../assets/Microphone on.svg";
import micOff from "../assets/Microphone off.svg";
import videoOnIcon from "../assets/Video on.svg";
import videoOffIcon from "../assets/Video off.svg";
import virtualBackgroundImage from "../assets/virtual-background.svg";
import "../styles/mobile-call.css";
import none from "../assets/none.png";
import blur from "../assets/blur.jpg";
import color from "../assets/white-color.png";
import logo from "../assets/vtalix-logo.png";

function getAppointmentApiBaseUrl() {
  return (
    import.meta.env.VITE_BACKEND_URL_APPOINTMENT_PUBLIC ||
    import.meta.env.VITE_BACKEND_URL_APPOINTMENT ||
    ""
  );
}

async function fetchPublicVideoSession(appointmentId) {
  const baseUrl = getAppointmentApiBaseUrl();
  if (!baseUrl || !appointmentId) {
    return null;
  }

  const response = await fetch(`${baseUrl}/video-session/${appointmentId}`);
  if (!response.ok) {
    throw new Error("Unable to fetch video session");
  }

  const payload = await response.json();
  return payload?.data?.data || payload?.data || null;
}

async function fetchPublicAgoraSession(appointmentId, roomId, socketId, displayName) {
  const baseUrl = getAppointmentApiBaseUrl();
  if (!baseUrl || !appointmentId) {
    return null;
  }

  const url = new URL(`${baseUrl}/video-session/${appointmentId}/agora-session`);
  url.searchParams.set("roomId", roomId || "");
  url.searchParams.set("socketId", socketId || "");
  url.searchParams.set("displayName", displayName || "Patient");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error("Unable to create Agora session");
  }

  const payload = await response.json();
  return payload?.data || null;
}

async function submitPublicVideoFeedback(appointmentId, payload) {
  const baseUrl = getAppointmentApiBaseUrl();
  if (!baseUrl || !appointmentId) {
    throw new Error("Missing appointment API URL");
  }

  const response = await fetch(`${baseUrl}/video-session/${appointmentId}/feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Unable to submit video feedback");
  }

  const data = await response.json();
  return data?.data || null;
}

function buildAppReturnUrl({ appointmentId, roomId, socketId }) {
  const baseUrl = import.meta.env.VITE_APP_RETURN_URL || "vtalix://video-call-ended";

  try {
    const url = new URL(baseUrl);
    url.searchParams.set("appointmentId", appointmentId || "");
    url.searchParams.set("roomId", roomId || "");
    url.searchParams.set("socketId", socketId || "");
    url.searchParams.set("status", "ended");
    return url.toString();
  } catch (_error) {
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}appointmentId=${encodeURIComponent(appointmentId || "")}&roomId=${encodeURIComponent(roomId || "")}&socketId=${encodeURIComponent(socketId || "")}&status=ended`;
  }
}

function notifyHostApp(payload) {
  const serializedPayload = JSON.stringify(payload);

  try {
    if (window.flutter_inappwebview?.callHandler) {
      window.flutter_inappwebview.callHandler("videoCallEnded", payload);
    }
  } catch (error) {
    console.warn("flutter_inappwebview handler failed", error);
  }

  try {
    if (window.VideoCallChannel?.postMessage) {
      window.VideoCallChannel.postMessage(serializedPayload);
    }
  } catch (error) {
    console.warn("VideoCallChannel postMessage failed", error);
  }

  try {
    if (window.VtalixBridge?.postMessage) {
      window.VtalixBridge.postMessage(serializedPayload);
    }
  } catch (error) {
    console.warn("VtalixBridge postMessage failed", error);
  }

  try {
    if (window.ReactNativeWebView?.postMessage) {
      window.ReactNativeWebView.postMessage(serializedPayload);
    }
  } catch (error) {
    console.warn("ReactNativeWebView postMessage failed", error);
  }

  try {
    window.dispatchEvent(new CustomEvent("vtalix:video-call-ended", { detail: payload }));
  } catch (error) {
    console.warn("Custom event dispatch failed", error);
  }
}

function getParticipantId(roomId) {
  const storageKey = `patient-call:${roomId}:participant`;
  const existingId = localStorage.getItem(storageKey);

  if (existingId) {
    return existingId;
  }

  const createdId = `patient-${roomId}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(storageKey, createdId);
  return createdId;
}

function getParticipantName(roomId) {
  const storageKey = `patient-call:${roomId}:name`;
  const existingName = localStorage.getItem(storageKey);

  if (existingName) {
    return existingName;
  }

  const createdName = "Patient";
  localStorage.setItem(storageKey, createdName);
  return createdName;
}

function normalizeMediaEnabled(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }

  return Boolean(value);
}

function normalizeMessages(entries = [], participantName) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .filter((entry) => entry && typeof entry === "object" && entry.message)
    .map((entry) => ({
      ...entry,
      isMine: entry?.meta?.name === participantName,
    }));
}

const backgroundModes = [
  {
    value: "off",
    label: "Off",
    description: "Use your original camera feed.",
    preview: none,
  },
  {
    value: "blur-low",
    label: "Blur (Low)",
    description: "Soft blur for the room behind you.",
    preview: blur,
  },
  {
    value: "blur-medium",
    label: "Blur (Medium)",
    description: "Moderate blur for the room behind you.",
    preview: blur,
  },
  {
    value: "blur-high",
    label: "Blur (High)",
    description: "Strong blur for the room behind you.",
    preview: blur,
  },
];

export default function MobileCall() {
  const { appointmentId, roomId, socketId } = useParams();
  const localRef = useRef(null);
  const remoteRef = useRef(null);
  const allowExitRef = useRef(false);
  const chatOpenRef = useRef(false);
  const agoraSessionRef = useRef(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [mediaError, setMediaError] = useState("");
  const [messages, setMessages] = useState([]);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [callEnded, setCallEnded] = useState(false);
  const [callStatus, setCallStatus] = useState("Connecting");
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [remoteVideoOff, setRemoteVideoOff] = useState(false);
  const [sessionMeta, setSessionMeta] = useState(null);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [backgroundMode, setBackgroundMode] = useState("off");
  const [backgroundMenuOpen, setBackgroundMenuOpen] = useState(false);
  const [backgroundSupported, setBackgroundSupported] = useState(true);
  const [backgroundError, setBackgroundError] = useState("");
  const navigate = useNavigate();
  const participantId = useMemo(() => getParticipantId(roomId), [roomId]);
  const participantName = useMemo(() => getParticipantName(roomId), [roomId]);
  const callStartedAt = useMemo(() => Date.now(), []);
  const reminderShownRef = useRef(false);
  const feedbackShownRef = useRef(false);
  const feedbackSubmittedRef = useRef(false);
  const pendingEndCallRef = useRef(false);

  useEffect(() => {
    chatOpenRef.current = chatOpen;

    if (chatOpen) {
      setUnreadChatCount(0);
    }
  }, [chatOpen]);

  useEffect(() => {
    if (!appointmentId) {
      return;
    }

    let active = true;

    const loadSessionMeta = async () => {
      try {
        const session = await fetchPublicVideoSession(appointmentId);
        if (!active || !session) {
          return;
        }

        setSessionMeta(session);
        setMessages(normalizeMessages(session.chatMessage, participantName));
        feedbackSubmittedRef.current = session.patientRating != null;
      } catch (error) {
        console.warn("Unable to fetch public video session", error);
      }
    };

    loadSessionMeta();

    return () => {
      active = false;
    };
  }, [appointmentId, participantName]);

  useEffect(() => {
    if (!sessionMeta?.scheduledStartAt) {
      return;
    }

    const runTimingChecks = () => {
      const startAt = new Date(sessionMeta.scheduledStartAt).getTime();
      const endAt = sessionMeta.scheduledEndAt
        ? new Date(sessionMeta.scheduledEndAt).getTime()
        : startAt + 60 * 60 * 1000;
      const now = Date.now();
      const reminderAt = startAt + 45 * 60 * 1000;
      const feedbackAt = endAt - 60 * 1000;

      if (!reminderShownRef.current && now >= reminderAt && now < endAt) {
        reminderShownRef.current = true;
        setReminderOpen(true);
      }

      if (!feedbackShownRef.current && !feedbackSubmittedRef.current && now >= feedbackAt) {
        feedbackShownRef.current = true;
        setFeedbackOpen(true);
      }
    };

    runTimingChecks();
    const intervalId = window.setInterval(runTimingChecks, 30000);
    return () => window.clearInterval(intervalId);
  }, [sessionMeta]);

  useEffect(() => {
    if (!appointmentId || !roomId || !socketId) {
      setCallStatus("Waiting");
      return;
    }

    let active = true;

    const handleRemoteMediaState = (payload) => {
      const type = String(payload?.type || "").toLowerCase();
      const enabled = normalizeMediaEnabled(
        payload?.enabled ?? (type === "audio" ? !payload?.muted : !payload?.videoOff)
      );

      if (type === "audio") {
        setRemoteMuted(!enabled);
      }

      if (type === "video") {
        setRemoteVideoOff(!enabled);
      }
    };

    const startAgoraCall = async () => {
      const agoraSession = await fetchPublicAgoraSession(appointmentId, roomId, socketId, participantName);
      if (!active || !agoraSession?.agora) {
        return;
      }

      setSessionMeta((previous) => ({
        ...(previous || {}),
        ...agoraSession,
      }));

      if (Array.isArray(agoraSession.chatMessage)) {
        setMessages(normalizeMessages(agoraSession.chatMessage, participantName));
      }

      agoraSessionRef.current = await createAgoraSession({
        appId: agoraSession.agora.appId,
        channelName: agoraSession.agora.channelName,
        rtcToken: agoraSession.agora.rtcToken,
        rtcUid: agoraSession.agora.rtcUid,
        rtmToken: agoraSession.agora.rtmToken,
        rtmUserId: agoraSession.agora.rtmUserId,
        localContainer: localRef.current,
        remoteContainer: remoteRef.current,
        onStatusChange: setCallStatus,
        onRemoteConnectedChange: setRemoteConnected,
        onRemoteVideoStateChange: setRemoteVideoOff,
        onRemoteAudioStateChange: setRemoteMuted,
        onChatMessage: (payload) => {
          setMessages((previous) => [
            ...previous,
            {
              ...payload,
              isMine: false,
            },
          ]);

          if (!chatOpenRef.current) {
            setUnreadChatCount((count) => count + 1);
          }
        },
        onMediaState: handleRemoteMediaState,
      });

      const supported = agoraSessionRef.current.isVirtualBackgroundSupported();
      setBackgroundSupported(supported);

      if (!supported) {
        setBackgroundError("Virtual background is not supported in this browser.");
      }
    };

    startAgoraCall().catch((error) => {
      console.error("Unable to start Agora mobile call", error);
      setMediaError(error?.message || "Unable to start video call");
      setCallStatus("Disconnected");
    });

    return () => {
      active = false;
      if (agoraSessionRef.current) {
        agoraSessionRef.current.leave().catch((error) => {
          console.warn("Unable to leave Agora mobile call cleanly", error);
        });
        agoraSessionRef.current = null;
      }
    };
  }, [appointmentId, participantName, roomId, socketId]);

  const toggleMute = async () => {
    const nextMuted = !muted;
    setMuted(nextMuted);

    try {
      await agoraSessionRef.current?.setAudioEnabled(!nextMuted);
    } catch (error) {
      console.warn("Unable to toggle microphone", error);
      setMuted((current) => !current);
    }
  };

  const toggleVideo = async () => {
    const nextVideoEnabled = !videoEnabled;
    setVideoEnabled(nextVideoEnabled);

    try {
      await agoraSessionRef.current?.setVideoEnabled(nextVideoEnabled);
    } catch (error) {
      console.warn("Unable to toggle camera", error);
      setVideoEnabled((current) => !current);
    }
  };

  const selectBackgroundMode = async (mode) => {
    if (!backgroundSupported) {
      setBackgroundError("Virtual background is not supported in this browser.");
      setBackgroundMenuOpen(false);
      return;
    }

    const previousMode = backgroundMode;
    setBackgroundError("");
    setBackgroundMode(mode);

    try {
      await agoraSessionRef.current?.setVirtualBackgroundMode(mode);
      setBackgroundMenuOpen(false);
    } catch (error) {
      console.warn("Unable to update virtual background", error);
      setBackgroundMode(previousMode);
      setBackgroundError(error?.message || "Unable to update virtual background.");
    }
  };

  const sendChatMessage = async (message) => {
    const payload = {
      kind: "chat",
      roomId,
      message,
      meta: {
        role: "patient",
        name: participantName,
      },
      timestamp: new Date().toISOString(),
    };

    setMessages((previous) => [
      ...previous,
      {
        ...payload,
        isMine: true,
      },
    ]);

    try {
      await agoraSessionRef.current?.sendChatMessage(payload);
    } catch (error) {
      console.warn("Unable to send chat message", error);
    }
  };

  const finishEndCall = async () => {
    allowExitRef.current = true;
    const endPayload = {
      type: "video-call-ended",
      appointmentId,
      roomId,
      socketId,
      participantId,
      participantName,
      endedAt: new Date().toISOString(),
      returnUrl: buildAppReturnUrl({ appointmentId, roomId, socketId }),
    };

    try {
      await agoraSessionRef.current?.leave();
      agoraSessionRef.current = null;
    } catch (error) {
      console.warn("Error ending Agora call", error);
    }

    notifyHostApp(endPayload);
    setChatOpen(false);

    try {
      window.location.href = endPayload.returnUrl;
    } catch (error) {
      console.warn("Unable to redirect back to app", error);
    }

    window.setTimeout(() => {
      try {
        window.close();
      } catch (error) {
        console.warn("Unable to close window", error);
      }
    }, 150);

    window.setTimeout(() => {
      setCallEnded(true);
    }, 500);
  };

  const handleFeedbackSubmit = async ({ rating, heading, description }) => {
    if (!appointmentId) {
      setFeedbackOpen(false);
      if (pendingEndCallRef.current) {
        pendingEndCallRef.current = false;
        await finishEndCall();
      }
      return;
    }

    setSubmittingFeedback(true);
    try {
      const updated = await submitPublicVideoFeedback(appointmentId, {
        role: "patient",
        rating,
        roomId,
        socketId,
        feedbackHeading: heading,
        feedbackDescription: description,
      });

      setSessionMeta(updated);
      feedbackSubmittedRef.current = true;
      setFeedbackOpen(false);

      if (pendingEndCallRef.current) {
        pendingEndCallRef.current = false;
        await finishEndCall();
      }
    } catch (error) {
      console.warn("Unable to submit patient feedback", error);
    } finally {
      setSubmittingFeedback(false);
    }
  };

  const handleFeedbackSkip = async () => {
    setFeedbackOpen(false);
    if (pendingEndCallRef.current) {
      pendingEndCallRef.current = false;
      await finishEndCall();
    }
  };

  const endCall = async () => {
    if (appointmentId && !feedbackSubmittedRef.current) {
      pendingEndCallRef.current = true;
      setFeedbackOpen(true);
      return;
    }

    await finishEndCall();
  };

  useEffect(() => {
    document.body.classList.add("no-scroll");
    return () => {
      document.body.classList.remove("no-scroll");
    };
  }, []);

  useEffect(() => {
    const blockKeys = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }

      if (
        event.key === "F5" ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const blockUnload = (event) => {
      if (allowExitRef.current) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    const blockBack = () => {
      if (allowExitRef.current) {
        return;
      }

      window.history.pushState(null, "", window.location.href);
    };

    document.addEventListener("keydown", blockKeys);
    window.addEventListener("beforeunload", blockUnload);
    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", blockBack);

    return () => {
      document.removeEventListener("keydown", blockKeys);
      window.removeEventListener("beforeunload", blockUnload);
      window.removeEventListener("popstate", blockBack);
    };
  }, []);

  if (callEnded) {
    return (
      <div className="mobile-call mobile-call--ended">
        <div className="mobile-call__ended-card">
          <div className="mobile-call__ended-icon">OK</div>
          <h1>Call ended</h1>
          <p>You have left this video session.</p>
          <button
            type="button"
            onClick={() => {
              window.location.replace("https://vtalix.com/");
            }}
          >
            Back to join page
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`mobile-call ${chatOpen ? "mobile-call--chat-open" : ""}`}>
      {mediaError ? (
        <div style={{ color: "#111827", padding: "12px", textAlign: "center" }}>
          {mediaError}
        </div>
      ) : null}
      <div className="remote-container">
        <div ref={remoteRef} className="remote" />

        <div className="call-topbar">
          <div>
            <p className="call-topbar__eyebrow">Therapist session</p>
            <h1 className="call-topbar__title">Therapist</h1>
          </div>
          <Timer startTime={callStartedAt} />
          <div className={`call-status call-status--${callStatus.toLowerCase().replace(/\s+/g, "-")}`}>
            <span aria-hidden="true" />
            {callStatus}
          </div>
        </div>

        {!remoteConnected && !remoteVideoOff ? (
          <div className="remote-placeholder" aria-live="polite">
            <div className="remote-placeholder__avatar">DR</div>
            <p className="remote-placeholder__label">{callStatus}</p>
            <h2>Waiting for the therapist</h2>
            <p className="remote-placeholder__hint">
              Keep this screen open. Your camera and microphone are ready.
            </p>
          </div>
        ) : null}

        <div className="status-overlay">
          <div className="remote-media-card" aria-label="Therapist media status">
            <span
              className={`remote-media-icon ${remoteMuted ? "is-off" : "is-on"}`}
              aria-label={remoteMuted ? "Therapist microphone is muted" : "Therapist microphone is on"}
            >
              <img src={remoteMuted ? micOff : micOn} alt="" />
            </span>
            <span
              className={`remote-media-icon ${remoteVideoOff ? "is-off" : "is-on"}`}
              aria-label={remoteVideoOff ? "Therapist camera is off" : "Therapist camera is on"}
            >
              <img src={remoteVideoOff ? videoOffIcon : videoOnIcon} alt="" />
            </span>
          </div>
        </div>

        {remoteVideoOff && (
          <div className="video-off-placeholder">
            <div className="remote-placeholder__avatar">DR</div>
            <img className="video-off-placeholder__icon" src={videoOffIcon} alt="" />
            <p>Therapist camera is off</p>
          </div>
        )}
      </div>

      <div className="local-container" aria-label="Your preview">
        <div ref={localRef} className="local" />
        {!videoEnabled && (
          <div className="local-video-off" aria-label="Your camera is off">
            <img src={videoOffIcon} alt="" />
          </div>
        )}
        <div className="local-container__label">You</div>
        <div className="local-media-badges">
          {muted && (
            <span className="local-media-badge" aria-label="Your microphone is muted">
              <img src={micOff} alt="" />
            </span>
          )}
          {backgroundMode !== "off" && (
            <span className="local-media-badge local-media-badge--background" aria-label={`Virtual background is ${backgroundMode}`}>
              BG
            </span>
          )}
        </div>
      </div>

      {backgroundMenuOpen && (
        <div className="background-menu" role="menu" aria-label="Virtual background options">
          <div className="background-menu__header">
            <div>
              <p>Virtual background</p>
              <span>Pick a blur, image, or solid color.</span>
            </div>
            <button type="button" onClick={() => setBackgroundMenuOpen(false)} aria-label="Close virtual background options">
              Close
            </button>
          </div>

          <div className="background-menu__grid">
            {backgroundModes.map((option) => {
              const isSelected = backgroundMode === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  className={`background-menu__option ${isSelected ? "is-selected" : ""}`}
                  onClick={() => selectBackgroundMode(option.value)}
                  aria-pressed={isSelected}
                >
                  <span
                    className={`background-menu__preview ${option.value === "blur" ? "is-blur" : ""} ${option.value === "color" ? "is-color" : ""}`}
                    style={option.preview ? { backgroundImage: `url(${option.preview})` } : undefined}
                    aria-hidden="true"
                  />
                  <span className="background-menu__meta">
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {backgroundError ? <p className="background-menu__error">{backgroundError}</p> : null}
        </div>
      )}

      <Controls
        onChat={() => {
          setChatOpen(true);
        }}
        onEnd={endCall}
        onBackground={() => {
          if (!backgroundSupported) {
            setBackgroundError("Virtual background is not supported in this browser.");
            return;
          }

          setBackgroundMenuOpen((open) => !open);
        }}
        onToggleMute={toggleMute}
        onToggleVideo={toggleVideo}
        backgroundEnabled={backgroundMode !== "off"}
        backgroundSupported={backgroundSupported}
        muted={muted}
        videoEnabled={videoEnabled}
        unreadChatCount={unreadChatCount}
      />

      <ChatDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={messages}
        participantName={participantName}
        onSend={sendChatMessage}
      />

      <CallNoticeModal
        open={reminderOpen}
        title="15 minutes remaining"
        description="This session is nearing its scheduled end time. Please begin wrapping up the call."
        onAction={() => setReminderOpen(false)}
      />

      <CallFeedbackModal
        open={feedbackOpen}
        title="Rate this video session"
        description="Please share your rating and quick feedback before leaving the call."
        submitLabel={submittingFeedback ? "Submitting..." : "Submit feedback"}
        disabled={submittingFeedback}
        onSubmit={handleFeedbackSubmit}
        onSkip={handleFeedbackSkip}
      />
    </div>
  );
}
