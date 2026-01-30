#!/usr/bin/env node
/**
 * Generates manifest.json from data/*.json files
 * Used by the visualization dashboard to discover trading sessions
 */

import { readdirSync, statSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = resolve(__dirname, '../../data');
const OUTPUT_FILE = resolve(__dirname, 'manifest.json');

function generateManifest() {
  try {
    const files = readdirSync(DATA_DIR)
      .filter(file => file.startsWith('fills-') && file.endsWith('.json'))
      .map(filename => {
        const filepath = join(DATA_DIR, filename);
        const stats = statSync(filepath);
        
        // Try to extract basic info from the file
        let conditionId = null;
        let tradeCount = 0;
        let lastUpdated = stats.mtimeMs;
        
        try {
          const content = JSON.parse(readFileSync(filepath, 'utf-8'));
          conditionId = content.conditionId || null;
          tradeCount = content.fills?.length || 0;
          lastUpdated = content.lastUpdated || stats.mtimeMs;
        } catch (err) {
          console.warn(`Warning: Could not parse ${filename}:`, err.message);
        }
        
        return {
          filename,
          conditionId,
          tradeCount,
          lastUpdated,
          fileSize: stats.size,
          modified: stats.mtimeMs
        };
      })
      .sort((a, b) => b.lastUpdated - a.lastUpdated); // Most recent first

    const manifest = {
      generated: Date.now(),
      count: files.length,
      files
    };

    writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2));
    console.log(`✓ Generated manifest with ${files.length} trading session(s)`);
    
    return manifest;
  } catch (error) {
    console.error('Error generating manifest:', error);
    process.exit(1);
  }
}

generateManifest();
