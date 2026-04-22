import { LiveServerMessage, BidiGenerateContentServerContent } from "@google/genai";
export function check(x: LiveServerMessage) {
  x.nonexistent;
}
export function check2(x: BidiGenerateContentServerContent) {
  x.nonexistent;
}
