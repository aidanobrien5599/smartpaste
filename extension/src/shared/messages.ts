/**
 * Every message the background worker answers: the content script's, and
 * the settings page's "profile-from-resume".
 *
 * The background (background.js, still JavaScript) is the only thing that
 * talks to Jev; the content script asks it through these (ContentMessage).
 * A new message type goes in MESSAGE_TYPES (and in ContentMessage if the
 * content script sends it); test/messages.test.mjs checks background.js
 * handles exactly this list.
 *
 * Depends on: shared/types.ts, for the Result each answered field comes back as.
 */
import type { Result } from "./types.ts";

export const MESSAGE_TYPES = ["answer-fields", "choose-option", "fill-page", "profile-from-resume"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export interface PageContext { url: string; title: string; heading?: string }

export interface AnswerFields {
  type: "answer-fields";
  fields: { label: string; options: string[] | null; multi: boolean }[];
  page: PageContext;
}
export interface ChooseOption { type: "choose-option"; label: string; want: string; options: string[] }
export interface FillPage { type: "fill-page" }

export type ContentMessage = AnswerFields | ChooseOption | FillPage;

export type AnswerFieldsReply = { ok: true; results: Result[] } | { ok: false; error: string };
export type ChooseOptionReply = { ok: boolean; index: number; confidence?: number };

type ReplyTo<M> = M extends AnswerFields ? AnswerFieldsReply : M extends ChooseOption ? ChooseOptionReply : { ok: boolean };

/** chrome.runtime.sendMessage with the reply typed by the message. */
export function send<M extends ContentMessage>(message: M): Promise<ReplyTo<M> | undefined> {
  return chrome.runtime.sendMessage(message);
}
