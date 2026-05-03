import type React from "react";
import { lazy, Suspense } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { MarkdownProps } from "./markdown";

const Markdown = lazy(() => import("./markdown").then((module) => ({ default: module.Markdown })));

export type MessageProps = {
  children: React.ReactNode;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

const Message = ({ children, className, ...props }: MessageProps) => (
  <div className={cn("flex gap-3", className)} {...props}>
    {children}
  </div>
);

export type MessageAvatarProps = {
  src?: string;
  alt: string;
  fallback?: string;
  delayMs?: number;
  className?: string;
};

const MessageAvatar = ({ src, alt, fallback, delayMs, className }: MessageAvatarProps) => {
  return (
    <Avatar className={cn("size-8 shrink-0", className)}>
      {src ? <AvatarImage src={src} alt={alt} /> : null}
      {fallback ? <AvatarFallback delay={delayMs}>{fallback}</AvatarFallback> : null}
    </Avatar>
  );
};

export type MessageContentProps = {
  children: React.ReactNode;
  markdown?: boolean;
  className?: string;
} & React.ComponentProps<typeof Markdown> &
  React.HTMLProps<HTMLDivElement>;

const MessageContent = ({ children, markdown = false, className, ...props }: MessageContentProps) => {
  const classNames = cn("rounded-lg bg-secondary p-2 text-foreground break-words whitespace-normal", className);

  return markdown ? (
    <Suspense fallback={<div className={classNames}>{children}</div>}>
      <Markdown className={classNames} {...(props as MarkdownProps)}>
        {children as string}
      </Markdown>
    </Suspense>
  ) : (
    <div className={classNames} {...props}>
      {children}
    </div>
  );
};

export type MessageActionsProps = {
  children: React.ReactNode;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

const MessageActions = ({ children, className, ...props }: MessageActionsProps) => (
  <div className={cn("flex items-center gap-2 text-muted-foreground", className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = {
  className?: string;
  tooltip: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
} & React.ComponentProps<typeof Tooltip>;

const MessageAction = ({ tooltip, children, className, side = "top", ...props }: MessageActionProps) => {
  return (
    <TooltipProvider>
      <Tooltip {...props}>
        <TooltipTrigger render={children as React.ReactElement} />
        <TooltipContent side={side} className={className}>
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export { Message, MessageAvatar, MessageContent, MessageActions, MessageAction };
