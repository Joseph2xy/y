"use client";

import type React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const systemMessageVariants = cva("flex flex-row items-center gap-3 rounded-lg border py-2 pr-2 pl-3", {
  variants: {
    variant: {
      action: "text-foreground",
      error: "text-destructive",
      warning: "text-foreground"
    },
    fill: {
      true: "bg-muted",
      false: ""
    }
  },
  compoundVariants: [
    {
      variant: "action",
      fill: false,
      class: "border-border"
    },
    {
      variant: "error",
      fill: false,
      class: "border-destructive"
    },
    {
      variant: "warning",
      fill: false,
      class: "border-border"
    }
  ],
  defaultVariants: {
    variant: "action",
    fill: false
  }
});

export type SystemMessageProps = React.ComponentProps<"div"> &
  VariantProps<typeof systemMessageVariants> & {
    icon?: React.ReactNode;
    isIconHidden?: boolean;
    cta?: {
      label: string;
      onClick?: () => void;
      variant?: "solid" | "outline" | "ghost";
    };
  };

export function SystemMessage({ children, variant = "action", fill = false, icon, isIconHidden = false, cta, className, ...props }: SystemMessageProps) {
  function getDefaultIcon() {
    if (isIconHidden) return null;

    if (variant === "error") return <AlertCircle className="size-4" />;
    if (variant === "warning") return <AlertTriangle className="size-4" />;
    return <Info className="size-4" />;
  }

  const iconToShow = isIconHidden ? null : icon ?? getDefaultIcon();

  return (
    <div className={cn(systemMessageVariants({ variant, fill }), className)} {...props}>
      <div className="flex flex-1 flex-row items-center gap-3 leading-normal">
        {iconToShow ? <div className="flex h-[1lh] shrink-0 items-center justify-center self-start">{iconToShow}</div> : null}
        <div className={cn("flex min-w-0 flex-1 items-center", iconToShow ? "gap-3" : "gap-0")}>
          <div className="text-sm">{children}</div>
        </div>
      </div>

      {cta ? (
        <Button variant={cta.variant === "outline" ? "outline" : cta.variant === "ghost" ? "ghost" : "default"} size="sm" onClick={cta.onClick}>
          {cta.label}
        </Button>
      ) : null}
    </div>
  );
}
