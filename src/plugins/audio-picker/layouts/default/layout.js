// @ts-check

// The built-in audio picker look: the heading and counts, each moment's
// numbered title and reason, one line per candidate row, the None of these
// row, and the moment's notes box under its label.
//
// What a user layout may leave out of a part it defines, and what the app
// does then:
// - candidate: `playButton` (`p` still plays the cursor row) and `waveform`
// - notes: `textBox` (the box is appended at the end of the part)

/** @typedef {import('../layout').CandidateRowInput} CandidateRowInput */

/** @type {Record<import('../layout').PlayMode, string>} */
const PLAY_LABELS = {
  'one-shot': 'One-shot',
  loop: 'Loop',
  variants: 'Variants',
};

/**
 * `3 moments · 1 on the recommendation · 2 none of these`.
 * @param {import('../layout').HeadInput} input
 */
function countsText(input) {
  const moments = input.moments === 1 ? 'moment' : 'moments';
  return `${input.moments} ${moments} · ${input.onRecommendation} on the recommendation · ${input.noneOfThese} none of these`;
}

/**
 * The row's length: `2.5 s` under a minute, else `m:ss`, from the length
 * rounded to a tenth; `Loading…` while it decodes, `–` with none.
 * @param {CandidateRowInput} input
 */
function lengthText(input) {
  if (input.load === 'loading') {
    return 'Loading…';
  }
  if (input.load === 'error' || input.durationSeconds === null) {
    return '–';
  }
  const rounded = Math.round(input.durationSeconds * 10) / 10;
  if (rounded < 60) {
    return `${rounded.toFixed(1)} s`;
  }
  const seconds = Math.floor(rounded);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * A semitone count: `+` before a positive one, no sign on zero.
 * @param {number} semitones
 */
function semitoneText(semitones) {
  if (semitones === 0) {
    return '0';
  }
  return semitones > 0 ? `+${String(semitones)}` : String(semitones);
}

/**
 * `-1 st`, `±2 st` or `-1 to +3 st`.
 * @param {{ min: number; max: number }} pitch
 */
function pitchText({ min, max }) {
  const isSymmetric = min === -max && max > 0;
  if (min === max) {
    return `${semitoneText(min)} st`;
  }
  if (isSymmetric) {
    return `±${String(max)} st`;
  }
  return `${semitoneText(min)} to ${semitoneText(max)} st`;
}

/**
 * The play-format Tag's text: `One-shot`, `Loop` or `Variants ×4`, then the
 * pitch range.
 * @param {CandidateRowInput} input
 */
function playText(input) {
  const format =
    input.play === 'variants'
      ? `${PLAY_LABELS.variants} ×${input.fileCount}`
      : PLAY_LABELS[input.play];
  return input.pitch === null
    ? format
    : `${format} · ${pitchText(input.pitch)}`;
}

/** @type {import('../layout').CompleteAudioPickerLayout} */
const layout = {
  head(parent, input, kit) {
    const head = kit.el(parent, 'div', 'audio-picker-head');
    kit.el(head, 'h2', 'audio-picker-heading', input.heading);
    if (input.overview.trim() !== '') {
      kit.markdown(head, input.overview, 'audio-picker-overview md');
    }
    kit.el(head, 'p', 'audio-picker-counts', countsText(input));
    kit.el(head, 'p', 'audio-picker-save', input.saveLabel);
    return { element: head };
  },
  moment(parent, input, kit) {
    const moment = kit.el(parent, 'div', 'audio-picker-moment');
    const header = kit.sectionHeader(moment, `${input.number}. ${input.title}`);
    if (input.isCursor) {
      kit.edge(header, 'prevMoment', { side: 'start', chevron: '▲' });
      kit.edge(header, 'nextMoment', { side: 'end', chevron: '▼' });
    }
    kit.markdown(moment, input.reason, 'audio-picker-reason md');
    return { element: moment };
  },
  candidate(parent, input, kit) {
    const row = kit.el(
      parent,
      'div',
      'audio-picker-row audio-picker-candidate',
    );
    row.classList.toggle('is-active', input.isPlaying);
    row.classList.toggle('audio-picker-recommended', input.isRecommended);
    row.dataset.load = input.load;
    const line = kit.el(row, 'div', 'audio-picker-row-line');
    kit.keyHint(line, 'choose', {
      arg: input.number,
      label: false,
      className: 'audio-picker-row-key',
    });
    kit.playButton(line);
    kit.waveform(line);
    kit.el(line, 'span', 'audio-picker-name', input.name);
    kit.el(line, 'span', 'audio-picker-library', input.library);
    kit.el(line, 'span', 'audio-picker-length', lengthText(input));
    if (input.loudnessLufs !== null) {
      kit.el(
        line,
        'span',
        'audio-picker-loudness',
        `${input.loudnessLufs.toFixed(1)} LUFS`,
      );
    }
    kit.tag(line, playText(input), 'neutral');
    if (input.isRecommended) {
      kit.tag(line, 'Recommended', 'accent');
    }
    if (input.isCursor) {
      kit.keyHint(line, 'togglePlay', {
        label: input.isPlaying ? 'stop' : 'play',
        className: 'audio-picker-cursor-prompt',
      });
    }
    if (input.load === 'error') {
      kit.el(
        row,
        'p',
        'audio-picker-load-error',
        `Can't load: ${input.error ?? ''}`,
      );
    }
    return { element: row };
  },
  none(parent, input, kit) {
    const row = kit.el(parent, 'div', 'audio-picker-row audio-picker-none');
    const line = kit.el(row, 'div', 'audio-picker-row-line');
    kit.keyHint(line, 'choose', {
      arg: input.number,
      label: false,
      className: 'audio-picker-row-key',
    });
    kit.el(line, 'span', 'audio-picker-none-label', 'None of these');
    return { element: row };
  },
  notes(parent, input, kit) {
    const notes = kit.el(parent, 'div', 'audio-picker-notes');
    const label = kit.el(notes, 'div', 'audio-picker-notes-label');
    kit.el(
      label,
      'span',
      'audio-picker-notes-title',
      input.isNone ? 'What to search for instead' : 'Note',
    );
    kit.keyHint(label, 'editNote', { className: 'audio-picker-notes-hint' });
    kit.textBox(notes);
    return { element: notes };
  },
};

export default layout;
