/** Candidates for the chat message box. */
export const INPUT_SELECTORS = ["textarea", '[contenteditable="true"]', '[role="textbox"]'];

/** The message box usually says something like "Type a message..." */
export const INPUT_HINT = /message/i;

/** A time label next to a message, e.g. "Nov 04, 12:43 AM" or "Feb 16, 2023, 7:20 PM". */
export const TIMESTAMP =
  /^(?:(?:[A-Za-z]{3,9}\.? \d{1,2}(?:, \d{4})?),? )?\d{1,2}:\d{2}(?:\s?[AaPp][Mm])?$/;

/** Fiverr gives each message part this readable class (seen in the diagnostic report). */
export const MESSAGE_PART = ".message-content";

/** Fallback: how many levels above a time label we look for the start of the message block. */
export const MAX_CLIMB = 12;