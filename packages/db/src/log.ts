export type Log = (msg: string, fields?: Record<string, unknown>) => void;

// JSON lines shaped like the services' pino logs. Callers log counts and ids only, never document contents.
export const logJson: Log = (msg, fields) => console.log(JSON.stringify({ level: 30, time: Date.now(), msg, ...fields }));
