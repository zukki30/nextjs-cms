"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { z } from "zod";

type SocialProvider = "google";

const providerLabels: Record<SocialProvider, string> = {
  google: "Google",
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loadingProvider, setLoadingProvider] = useState<SocialProvider | null>(
    null,
  );
  const [emailLoading, setEmailLoading] = useState(false);

  const handleSocialSignIn = async (provider: SocialProvider) => {
    setError(null);
    setLoadingProvider(provider);
    try {
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider,
          callbackURL: "/",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data?.message ?? "Social sign-in failed. Please try again.",
        );
      }
      if (data?.url) {
        window.location.href = data.url as string;
        return;
      }
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Social sign-in failed.");
    } finally {
      setLoadingProvider(null);
    }
  };

  const handleEmailSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setEmailLoading(true);

    const formData = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      email: String(formData.get("email") || ""),
      password: String(formData.get("password") || ""),
    });

    if (!parsed.success) {
      const messages = parsed.error.issues.map((issue) => issue.message);
      setError(messages[0] || "Email and password are required.");
      setEmailLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: parsed.data.email,
          password: parsed.data.password,
          callbackURL: "/",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data?.message ?? "Email sign-in failed. Please try again.",
        );
      }
      if (data?.url) {
        window.location.href = data.url as string;
        return;
      }
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Email sign-in failed.");
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <main>
      <h1>Login</h1>

      <section>
        <h2>Social</h2>
        {(
          Object.keys(providerLabels) as Array<keyof typeof providerLabels>
        ).map((provider) => (
          <button
            key={provider}
            type="button"
            onClick={() => handleSocialSignIn(provider)}
            disabled={loadingProvider === provider}
          >
            Continue with {providerLabels[provider]}
          </button>
        ))}
      </section>

      <section>
        <h2>Email</h2>
        <form onSubmit={handleEmailSignIn}>
          <div>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" />
          </div>
          <div>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
            />
          </div>
          <button type="submit" disabled={emailLoading}>
            Sign in
          </button>
        </form>
      </section>

      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
