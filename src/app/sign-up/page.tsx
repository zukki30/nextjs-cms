"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") || "");
    const email = String(formData.get("email") || "");
    const password = String(formData.get("password") || "");

    if (!name || !email || !password) {
      setError("Name, email, and password are required.");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          email,
          password,
          callbackURL: "/",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.message ?? "Sign-up failed. Please try again.");
      }
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main>
      <h1>Sign up</h1>

      <section>
        <h2>Create your account</h2>
        <form onSubmit={handleSignUp}>
          <div>
            <label htmlFor="name">Name</label>
            <input id="name" name="name" type="text" autoComplete="name" />
          </div>
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
              autoComplete="new-password"
            />
          </div>
          <button type="submit" disabled={loading}>
            Sign up
          </button>
        </form>
      </section>

      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
