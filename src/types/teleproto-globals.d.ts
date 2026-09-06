// Shim for an upstream bug in teleproto's published type declarations.
//
// teleproto/define.d.ts uses InlineKeyboard and ReplyKeyboard in its MarkupLike
// union but never imports them (true in v1.229.0 and at upstream HEAD). Because
// define.d.ts is a module, those names resolve as globals, so tsc reports
// TS2304 for every consumer that type-checks its dependencies.
//
// Declaring them globally here satisfies define.d.ts with the real classes from
// teleproto/tl/custom/keyboard. Delete this file once upstream adds the imports.
import type {
  InlineKeyboard as TeleprotoInlineKeyboard,
  ReplyKeyboard as TeleprotoReplyKeyboard,
} from 'teleproto/tl/custom/keyboard.js';

declare global {
  type InlineKeyboard = TeleprotoInlineKeyboard;
  type ReplyKeyboard = TeleprotoReplyKeyboard;
}
