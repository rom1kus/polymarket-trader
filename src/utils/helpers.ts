/**
 * Common helper utilities.
 *
 * General-purpose utilities used across the application.
 */

/**
 * Sleeps for a given number of milliseconds.
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the delay
 *
 * @example
 * await sleep(1000); // Wait 1 second
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Formats a timestamp for logging.
 *
 * @param date - Date to format (defaults to now)
 * @returns Formatted timestamp string (YYYY-MM-DD HH:MM:SS)
 *
 * @example
 * formatTimestamp(); // "2024-01-15 14:30:45"
 */
export function formatTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace("T", " ").substring(0, 19);
}

/**
 * Creates a logger function with timestamp prefix.
 *
 * @param prefix - Optional prefix to add after timestamp
 * @returns Logger function
 *
 * @example
 * const log = createLogger();
 * log("Starting..."); // [2024-01-15 14:30:45] Starting...
 *
 * const log = createLogger("BOT");
 * log("Running"); // [2024-01-15 14:30:45] [BOT] Running
 */
export function createLogger(prefix?: string): (message: string) => void {
  return (message: string) => {
    const timestamp = formatTimestamp();
    const prefixStr = prefix ? `[${prefix}] ` : "";
    console.log(`[${timestamp}] ${prefixStr}${message}`);
  };
}

/**
 * Simple logger with timestamp.
 *
 * @param message - Message to log
 */
export function log(message: string): void {
  console.log(`[${formatTimestamp()}] ${message}`);
}
