/**
 * @module chat-event
 *
 * Composable components for rendering a single message or event row
 * inside `ChatMessages`. Build different message layouts (primary
 * messages by combining these primitives.
 *
 * Typical structure for a primary message:
 * ```
 * ChatEvent
 * ├── ChatEventAddon   ← side column (avatar)
 * │   └── ChatEventAvatar
 * └── ChatEventBody    ← main content (flex-1)
 *     ├── ChatEventTitle
 *     │   └── sender name
 *     └── ChatEventContent
 * ```
 *
 * @see {@link ChatMessages} for the parent scrollable container.
 */

import { cn } from "@/lib/utils";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";

export type ChatEventProps = React.ComponentProps<"div">;

/**
 * Flex row wrapper for a single message or event. Each event typically
 * contains a `ChatEventAddon` (side column) and a `ChatEventBody`
 * (main content area).
 *
 * @example
 * ```tsx
 * // Primary message
 * <ChatEvent className="hover:bg-accent">
 *   <ChatEventAddon>
 *     <ChatEventAvatar src="/avatar.png" alt="@user" fallback="AS" />
 *   </ChatEventAddon>
 *   <ChatEventBody>
 *     <ChatEventTitle>
 *       <span className="font-medium">Ann Smith</span>
 *     </ChatEventTitle>
 *     <ChatEventContent>Hello, world!</ChatEventContent>
 *   </ChatEventBody>
 * </ChatEvent>
 * ```
 */
export function ChatEvent({ children, className, ...props }: ChatEventProps) {
  return (
    <div
      className={cn(
        "flex gap-2 px-2 relative group/event hover:z-10",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type ChatEventAddonProps = React.ComponentProps<"div">;

/**
 * Fixed-width side column within a `ChatEvent`. Typically holds a
 * `ChatEventAvatar` for primary messages. Responsive width via
 * container queries.
 *
 * @example
 * ```tsx
 * <ChatEventAddon>
 *   <ChatEventAvatar src="/avatar.png" fallback="AS" />
 * </ChatEventAddon>
 * ```
 */
export function ChatEventAddon({
  children,
  className,
  ...props
}: ChatEventAddonProps) {
  return (
    <div
      className={cn(
        "w-10 @md/chat:w-12 h-full flex justify-center pt-1 shrink-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type ChatEventBodyProps = React.ComponentProps<"div">;

/**
 * Main content area within a `ChatEvent`. Uses `flex-1` to fill the
 * remaining space beside `ChatEventAddon`. Contains `ChatEventTitle`
 * and `ChatEventContent`.
 *
 * @example
 * ```tsx
 * <ChatEventBody>
 *   <ChatEventTitle>
 *     <span className="font-medium">Ann Smith</span>
 *   </ChatEventTitle>
 *   <ChatEventContent>Hello, world!</ChatEventContent>
 * </ChatEventBody>
 * ```
 */
export function ChatEventBody({
  children,
  className,
  ...props
}: ChatEventBodyProps) {
  return (
    <div className={cn("flex-1 flex flex-col", className)} {...props}>
      {children}
    </div>
  );
}

export type ChatEventContentProps = React.ComponentProps<"div">;

/**
 * Message text container with responsive text sizing via container
 * queries (`text-sm` → `@md/chat:text-base`).
 *
 * @example
 * ```tsx
 * <ChatEventContent>Hello, world!</ChatEventContent>
 * ```
 */
export function ChatEventContent({
  children,
  className,
  ...props
}: ChatEventContentProps) {
  return (
    <div
      className={cn(
        "text-sm @md/chat:text-base whitespace-pre-wrap",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type ChatEventTitleProps = React.ComponentProps<"div">;

/**
 * Row for the sender name and metadata. Typically the first child of
 * `ChatEventBody`.
 *
 * @example
 * ```tsx
 * <ChatEventTitle>
 *   <span className="font-medium">Ann Smith</span>
 * </ChatEventTitle>
 * ```
 */
export function ChatEventTitle({
  children,
  className,
  ...props
}: ChatEventTitleProps) {
  return (
    <div
      className={cn("flex items-center gap-2 text-sm", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export interface ChatEventAvatarProps extends React.ComponentProps<typeof Avatar> {
  className?: string;
  /** Image URL for the avatar. */
  src?: React.ComponentProps<typeof AvatarImage>["src"];
  /** Alt text for the avatar image. */
  alt?: string;
  /** Fallback content shown while the image loads or if it fails (e.g. initials). */
  fallback?: React.ReactNode;
  /** Additional props forwarded to the inner `AvatarImage`. */
  imageProps?: React.ComponentProps<typeof AvatarImage>;
  /** Additional props forwarded to the inner `AvatarFallback`. */
  fallbackProps?: React.ComponentProps<typeof AvatarFallback>;
}

/**
 * Avatar sized for message rows. Responsive sizing via container
 * queries (`size-8` → `@md/chat:size-10`). Built on Radix UI Avatar
 * primitives.
 *
 * @example
 * ```tsx
 * <ChatEventAvatar
 *   src="https://example.com/avatar.png"
 *   alt="@annsmith"
 *   fallback="AS"
 * />
 * ```
 */
export function ChatEventAvatar({
  className,
  src,
  alt,
  fallback,
  imageProps,
  fallbackProps,
  ...props
}: ChatEventAvatarProps) {
  return (
    <Avatar
      className={cn("rounded-full size-8 @md/chat:size-10", className)}
      {...props}
    >
      <AvatarImage src={src} alt={alt} {...imageProps} />
      {fallback && (
        <AvatarFallback {...fallbackProps}>{fallback}</AvatarFallback>
      )}
    </Avatar>
  );
}
