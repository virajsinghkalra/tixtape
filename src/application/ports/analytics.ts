/** D-090: product analytics and opt-in identity. Implemented in Postgres (infrastructure/db). */
import type { AnalyticsEvent } from "@/domain/analytics/beacon";
import type { Contact } from "@/domain/analytics/identity";
import type { TrafficSource } from "@/domain/analytics/source";

export type VisitContext = {
  deviceId: string;
  source: TrafficSource;
  /** A known Indian city, else null. */
  city: string | null;
  at: Date;
};

/** What happened to a contact: saved, or left alone because another device owns the email. */
export type ContactOutcome = "saved" | "kept";

export interface AnalyticsStore {
  /** Upserts the device (first/last seen, first source) and appends the events. */
  record(visit: VisitContext, events: readonly AnalyticsEvent[]): Promise<void>;
  /** Sets the nickname on the device's person, creating the person if needed. */
  setNickname(deviceId: string, nickname: string, at: Date): Promise<void>;
  /**
   * Saves an email with consent on the device's person. An email already held by another
   * person is never re-linked or changed (there is no verification yet): returns "kept".
   */
  saveContact(deviceId: string, contact: Contact, at: Date): Promise<ContactOutcome>;
  /**
   * Deletes the device's person (if any) and every linked device, and anonymises their events.
   * Returns how many events were anonymised.
   */
  deleteDeviceData(deviceId: string): Promise<{ person: boolean; events: number }>;
  /** Retention: deletes events before `before`, and idle anonymous devices. */
  prune(before: Date): Promise<{ events: number; devices: number }>;
}

// ── The admin dashboard (read model) ───────────────────────────────────────

export type Count = { key: string; count: number };

export type AnalyticsOverview = {
  dau: number;
  wau: number;
  mau: number;
  /** Devices active in the last 7 days that were first seen in those 7 days. */
  newDevices: number;
  returningDevices: number;
  /** Active devices per IST day, oldest first, 30 entries. */
  daily: { day: string; devices: number }[];
};

export type FunnelStep = { step: string; devices: number };

export type TopLists = {
  events: { eventId: string; title: string | null; opens: number }[];
  artists: Count[];
  wanted: Count[];
  searches: { query: string; count: number; results: number }[];
  zeroResults: Count[];
  cities: Count[];
  sources: Count[];
  shares: Count[];
};

export type NamedPerson = {
  id: string;
  nickname: string | null;
  name: string | null;
  email: string | null;
  consentAt: Date | null;
  firstSeen: Date | null;
  lastSeen: Date | null;
  source: string | null;
  devices: number;
  events: number;
};

export type TimelineEntry = { name: string; props: Record<string, unknown>; at: Date };

export type AnalyticsDashboard = {
  overview: AnalyticsOverview;
  funnel: FunnelStep[];
  top: TopLists;
  people: NamedPerson[];
  /** Devices active in the window without a person (counted, never listed). */
  anonymousDevices: number;
};

export interface AnalyticsReadModel {
  dashboard(now: Date): Promise<AnalyticsDashboard>;
  person(id: string): Promise<{ person: NamedPerson; timeline: TimelineEntry[] } | null>;
}
