// src/components/logo.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

type LogoProps = {
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  showWordmark?: boolean;
  className?: string;
};

const IMG_CLASS: Record<NonNullable<LogoProps["size"]>, string> = {
  sm: "h-7 w-7",
  md: "h-9 w-9",
  lg: "h-11 w-11",
  xl: "h-14 w-14",
  "2xl": "h-16 w-16",
};

export default function Logo({ size = "md", showWordmark = true, className }: LogoProps) {
  // 1) /logo.png -> 2) /icon.png -> 3) SVG placeholder
  const [src, setSrc] = useState<string>("/logo.png");
  const [fallbackTried, setFallbackTried] = useState(false);

  useEffect(() => setSrc("/logo.png"), []);

  const onError = () => {
    if (!fallbackTried) {
      setFallbackTried(true);
      setSrc("/icon.png");
    }
  };

  return (
    <Link
      href="/"
      className={cn("app-logo flex items-center gap-3 shrink-0 select-none", className)}
      aria-label="Ir al inicio"
    >
      <div
        className={cn(
          "relative rounded-full overflow-hidden ring-1 ring-black/10 dark:ring-white/10",
          IMG_CLASS[size]
        )}
      >
        {src ? (
          <Image
            src={src}
            alt="ANTON.IA"
            fill
            sizes="64px"
            className="object-cover"
            onError={onError}
            priority
            unoptimized
          />
        ) : (
          <svg viewBox="0 0 64 64" className="h-full w-full">
            <circle cx="32" cy="32" r="31" fill="#111827" />
            <text x="50%" y="55%" textAnchor="middle" fontSize="20" fill="#fff" fontFamily="Poppins, sans-serif">A</text>
          </svg>
        )}
      </div>

      {showWordmark && (
        <span
          className={cn(
            // base + responsive boost
            "font-headline font-semibold tracking-tight leading-none text-foreground",
            "text-[1.15rem] md:text-[1.35rem] lg:text-[1.5rem]"
          )}
        >
          ANTON<span className="align-baseline">.</span>IA
        </span>
      )}
    </Link>
  );
}
