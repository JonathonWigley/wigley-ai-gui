import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Type tests run here too, so a misspelled name in one fails at run time.
    include: [
      'src/**/*.test.ts',
      'src/**/*.test-d.ts',
      'scripts/**/*.test.mts',
    ],
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts'],
    },
  },
});
