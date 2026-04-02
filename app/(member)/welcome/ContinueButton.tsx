"use client";

import { useRouter } from "next/navigation";
import { markWelcomeSeen } from "./actions";

export default function ContinueButton() {
  const router = useRouter();

  async function handleClick() {
    await markWelcomeSeen();
    router.push("/dashboard");
  }

  return (
    <button
      onClick={handleClick}
      className="inline-block px-8 py-3 bg-marine text-white rounded-lg font-body font-medium text-sm hover:bg-marine-light transition-colors"
    >
      Continue to Dashboard &rarr;
    </button>
  );
}
