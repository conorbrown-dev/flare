import { notificationsWanted } from "./storage";

// System notifications need a "secure context" (https, or localhost).
// Android Chrome only allows them through a service worker, and iPhone Safari
// only when the site has been added to the home screen (iOS 16.4+).

export const notificationsSupported = () =>
  typeof window !== "undefined" && "Notification" in window && window.isSecureContext;

export const notificationPermission = (): NotificationPermission | "unsupported" =>
  notificationsSupported() ? Notification.permission : "unsupported";

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  try { await navigator.serviceWorker.register("/sw.js"); } catch { /* notifications fall back to the page */ }
}

export async function requestNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

/** Shows a system notification, but only when this tab isn't the one being looked at. */
export async function notify(title: string, body: string, tag?: string) {
  if (!notificationsWanted() || notificationPermission() !== "granted") return;
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  await show(title, body, tag);
}

/** Shows a notification right away (used by "Send a test notification"). Returns false if the browser refused. */
export async function notifyNow(title: string, body: string) {
  if (notificationPermission() !== "granted") return false;
  return show(title, body, `test-${Date.now()}`);
}

async function show(title: string, body: string, tag?: string): Promise<boolean> {
  // One notification per room (the tag) that updates in place, but re-alerts for each
  // new message. Without renotify, Chrome silently swaps the text and nobody notices.
  const options: NotificationOptions & { renotify?: boolean } = {
    body, tag, renotify: !!tag, icon: "/icon.svg", badge: "/icon.svg", data: { url: location.href },
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification(title, options); return true; }
  } catch { /* fall through */ }
  try {
    const n = new Notification(title, options);
    n.onclick = () => { window.focus(); n.close(); };
    return true;
  } catch {
    return false; // this browser refuses page notifications
  }
}
