import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function JoinRoom() {
  const [appointmentId, setAppointmentId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [socketId, setSocketId] = useState("");
  const navigate = useNavigate();

  const handleJoin = () => {
    if (!appointmentId.trim() || !roomId.trim() || !socketId.trim()) {
      alert("Please enter appointment ID, room ID, and socket ID");
      return;
    }

    navigate(`/call/${appointmentId.trim()}/${roomId.trim()}/${socketId.trim()}`);
  };

  return (
    <div style={styles.container}>
      <h2>Join Video Call</h2>

      <input
        type="text"
        placeholder="Enter Appointment ID"
        value={appointmentId}
        onChange={(e) => setAppointmentId(e.target.value)}
        style={styles.input}
      />

      <input
        type="text"
        placeholder="Enter Room ID"
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
        style={styles.input}
      />

      <input
        type="text"
        placeholder="Enter Socket ID"
        value={socketId}
        onChange={(e) => setSocketId(e.target.value)}
        style={styles.input}
      />

      <button onClick={handleJoin} style={styles.button}>
        Join Call
      </button>
    </div>
  );
}

const styles = {
  container: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: "12px",
    background: "#000",
    color: "#fff",
  },
  input: {
    padding: "10px",
    width: "220px",
    borderRadius: "6px",
    border: "none",
    outline: "none",
  },
  button: {
    padding: "10px 16px",
    borderRadius: "6px",
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontWeight: "bold",
    cursor: "pointer",
  },
};
