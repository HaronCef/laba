import { z } from 'zod';

// Одна подія логу матчу (рядок NDJSON). Схема потрібна двічі:
// тип для Room, а при читанні файлу - перевірка, бо файл теж вхід ззовні.
export const LogEventSchema = z.discriminatedUnion('type', [
  z.object({
    t: z.number(),
    room: z.string(),
    type: z.literal('join'),
    player: z.number(),
    name: z.string(),
  }),
  z.object({
    t: z.number(),
    room: z.string(),
    type: z.literal('leave'),
    player: z.number(),
    name: z.string(),
  }),
  z.object({
    t: z.number(),
    room: z.string(),
    type: z.literal('chat'),
    player: z.number(),
    text: z.string(),
  }),
]);
export type LogEvent = z.infer<typeof LogEventSchema>;
