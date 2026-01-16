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

/**
 * Prompts the user for input from stdin.
 *
 * @param question - The prompt to display
 * @returns Promise that resolves with the user's input
 */
export function promptForInput(question: string): Promise<string> {
  return new Promise((resolve) => {
    const readline = require("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prompts for a numeric input with validation.
 *
 * @param question - The prompt to display
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Promise that resolves with the number, or null if skipped/invalid
 */
export async function promptForNumber(
  question: string,
  min: number = 0,
  max: number = 1
): Promise<number | null> {
  const answer = await promptForInput(question);

  // Allow skipping
  if (answer === "" || answer.toLowerCase() === "skip" || answer.toLowerCase() === "n") {
    return null;
  }

  const num = parseFloat(answer);
  if (isNaN(num)) {
    log(`Invalid number: ${answer}`);
    return null;
  }

  if (num < min || num > max) {
    log(`Number ${num} is out of range [${min}, ${max}]`);
    return null;
  }

  return num;
}
