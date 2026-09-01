"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/ui/AppShell";
import logo from "../../../assets/Logo_PelletQ-AI.png";
import loginBg from "../../../assets/login-bg.png";

function LoginForm() {
  const searchParams = useSearchParams();
  const hasError = !!searchParams.get("error");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    // redirectTo: "/" → sukses diarahkan ke beranda. Kalau gagal, Auth.js
    // mengarahkan balik ke /login?error=... (ditangkap via searchParams).
    await signIn("credentials", { username, password, redirectTo: "/" });
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "13px 15px",
    fontSize: 15,
    fontWeight: 600,
    color: "#1C2E27",
    background: "#fff",
    border: "1.5px solid #E4DECF",
    borderRadius: 13,
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12.5,
    fontWeight: 700,
    color: "#46554E",
    marginBottom: 7,
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "32px 22px calc(32px + env(safe-area-inset-bottom))",
        gap: 24,
      }}
    >
      {/* Brand — logo + wordmark gradien (signature app) */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div
          style={{
            width: 66,
            height: 66,
            borderRadius: 20,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#fff",
            border: "1px solid #E7E1D2",
            boxShadow: "0 12px 30px rgba(37,99,235,.18), 0 4px 16px rgba(0,0,0,.28)",
          }}
        >
          <Image src={logo} alt="Logo PelletQ-AI" width={66} height={66} priority unoptimized />
        </div>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: 27,
              fontWeight: 800,
              letterSpacing: "-.03em",
              lineHeight: 1,
              background: "linear-gradient(135deg, #7700FF 0%, #2563EB 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
              filter: "drop-shadow(0 2px 10px rgba(0,0,0,.35))",
            }}
          >
            PelletQ-AI
          </div>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "#fff",
              marginTop: 7,
              textShadow: "0 1px 3px rgba(0,0,0,.8), 0 1px 8px rgba(0,0,0,.6)",
            }}
          >
            Formulasi pakan lele otomatis berbasis SNI
          </div>
        </div>
      </div>

      {/* Kartu login */}
      <form
        onSubmit={handleSubmit}
        style={{
          background: "#fff",
          border: "1px solid #ECE6D8",
          borderRadius: 22,
          padding: "22px 20px",
          boxShadow: "0 4px 22px rgba(28,46,39,.06)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.02em" }}>Masuk ke akun</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#9AA69E", marginTop: 3 }}>
            Kelola formulasi &amp; mesin pelet Anda.
          </div>
        </div>

        {hasError && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "#FBE9E5",
              border: "1px solid #EDC4BB",
              color: "#9E3B30",
              fontSize: 13,
              fontWeight: 700,
              padding: "11px 13px",
              borderRadius: 12,
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            Username atau password salah.
          </div>
        )}

        <div>
          <label htmlFor="username" style={labelStyle}>
            Username
          </label>
          <input
            id="username"
            type="text"
            autoComplete="username"
            autoFocus
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="pelletq"
            style={inputStyle}
          />
        </div>

        <div>
          <label htmlFor="password" style={labelStyle}>
            Password
          </label>
          <div style={{ position: "relative" }}>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{ ...inputStyle, paddingRight: 46 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
              style={{
                position: "absolute",
                right: 7,
                top: "50%",
                transform: "translateY(-50%)",
                width: 34,
                height: 34,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                color: "#9AA69E",
                borderRadius: 9,
                cursor: "pointer",
              }}
            >
              {showPassword ? (
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22" />
                  <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" />
                </svg>
              ) : (
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 9,
            width: "100%",
            marginTop: 2,
            padding: 16,
            borderRadius: 16,
            background: "linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%)",
            color: "#fff",
            fontSize: 16,
            fontWeight: 800,
            letterSpacing: "-.01em",
            cursor: submitting ? "default" : "pointer",
            boxShadow: "0 8px 20px rgba(29,78,216,.24)",
            opacity: submitting ? 0.75 : 1,
          }}
        >
          {submitting ? (
            <>
              <span
                style={{
                  width: 17,
                  height: 17,
                  borderRadius: "50%",
                  border: "2.4px solid rgba(255,255,255,.4)",
                  borderTopColor: "#fff",
                  animation: "spin .7s linear infinite",
                  display: "block",
                }}
              />
              Memproses…
            </>
          ) : (
            "Masuk"
          )}
        </button>
      </form>

      <div
        style={{
          textAlign: "center",
          fontSize: 11.5,
          fontWeight: 700,
          color: "#fff",
          textShadow: "0 1px 3px rgba(0,0,0,.8), 0 1px 8px rgba(0,0,0,.6)",
        }}
      >
        PelletQ-AI · PKM-PI UGM
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <AppShell background={loginBg.src}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AppShell>
  );
}
