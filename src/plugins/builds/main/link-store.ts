import { type Files, readIfPresent } from '../../../contracts/files';
import { errorText } from '../../../shared/error-text';
import { isJsonObject } from '../../../shared/json';
import type { SessionLink, SetRun } from '../builds-model';
import type { BuildOffer, BuildRef } from '../contract';

// How long a link, a set run or an offer stays once it is done with: 14 days after its build ends, or after it was
// made when its build was never seen to end and is known to be unlisted.
export const PRUNE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
export const LINKS_FILE = 'session-links.json';

interface LinksValue {
  links: SessionLink[];
  setRuns: SetRun[];
  offers: Record<string, BuildOffer>; // by session id
}

// The session links, set runs and offers in `LINKS_FILE` of the plugin data. Every change applies in memory at once
// and writes the whole file after every earlier write, and after the load. `load` keeps every change made before it
// settled, on top of what the file held; after a `load` that rejects (text that is not JSON, or a top level or a
// member of the wrong type), nothing is written for the rest of the run, so the file stays for the user to read. An
// entry of the wrong shape is dropped, and their count logged once. `written` resolves once every write so far
// settled: true when the last one landed, false when it rejected (logged) or the store is not writable. `prune` drops
// what is done with, a never-ended link or set run only when `isUnlisted` holds for its builds, writes when it dropped
// something, and says whether it did.
export interface LinkStore {
  load(): Promise<void>;
  links(): SessionLink[];
  setRuns(): SetRun[];
  offers(): Record<string, BuildOffer>;
  addLinks(links: readonly SessionLink[]): void;
  addSetRun(run: SetRun): void;
  setOffer(sessionId: string, offer: BuildOffer | null): void;
  updateLinks(
    match: (link: SessionLink) => boolean,
    change: Partial<SessionLink>,
  ): void;
  updateSetRun(id: string, change: Partial<SetRun>): void;
  written(): Promise<boolean>;
  prune(now: number, isUnlisted: (ref: BuildRef) => boolean): boolean;
}

export function createLinkStore(
  files: Files,
  log: (line: string) => void,
): LinkStore {
  let value: LinksValue = { links: [], setRuns: [], offers: {} };
  let isWritable = true;
  // Settles once the load settled, so no write lands before the file was read.
  let loaded: Promise<void> = Promise.resolve();
  let lastWrite: Promise<boolean> = Promise.resolve(true);

  const write = () => {
    lastWrite = lastWrite
      .then(() => loaded)
      .then(async () => {
        if (!isWritable) {
          return false;
        }
        await files.write(LINKS_FILE, JSON.stringify(value, null, 2));
        return true;
      })
      .catch((error: unknown) => {
        log(`${LINKS_FILE} not written: ${errorText(error)}`);
        return false;
      });
  };

  const load = async () => {
    try {
      const text = await readIfPresent(files, LINKS_FILE);
      const read = text === null ? null : readLinks(text);
      if (read === null) {
        return;
      }
      if (read.dropped > 0) {
        log(`${LINKS_FILE}: dropped ${read.dropped} bad entries`);
      }
      value = {
        links: [...read.value.links, ...value.links],
        setRuns: [...read.value.setRuns, ...value.setRuns],
        offers: { ...read.value.offers, ...value.offers },
      };
    } catch (error) {
      isWritable = false;
      throw error;
    }
  };

  return {
    load() {
      const loading = load();
      loaded = loading.catch(() => undefined);
      return loading;
    },
    links: () => [...value.links],
    setRuns: () => [...value.setRuns],
    offers: () => ({ ...value.offers }),
    addLinks(links) {
      value = { ...value, links: [...value.links, ...links] };
      write();
    },
    addSetRun(run) {
      value = { ...value, setRuns: [...value.setRuns, run] };
      write();
    },
    setOffer(sessionId, offer) {
      const offers = { ...value.offers };
      if (offer === null) {
        delete offers[sessionId];
      } else {
        offers[sessionId] = offer;
      }
      value = { ...value, offers };
      write();
    },
    updateLinks(match, change) {
      value = {
        ...value,
        links: value.links.map((link) =>
          match(link) ? { ...link, ...change } : link,
        ),
      };
      write();
    },
    updateSetRun(id, change) {
      value = {
        ...value,
        setRuns: value.setRuns.map((run) =>
          run.id === id ? { ...run, ...change } : run,
        ),
      };
      write();
    },
    written: () => lastWrite,
    prune(now, isUnlisted) {
      const isKept = (
        endedAt: number | null,
        madeAt: number,
        unlisted: boolean,
      ): boolean =>
        endedAt === null
          ? !unlisted || now - madeAt <= PRUNE_AFTER_MS
          : now - endedAt <= PRUNE_AFTER_MS;
      const links = value.links.filter((link) =>
        isKept(link.endedAt, link.linkedAt, isUnlisted(link)),
      );
      const setRuns = value.setRuns.filter((run) =>
        isKept(run.endedAt, run.createdAt, run.builds.every(isUnlisted)),
      );
      const offers = Object.fromEntries(
        Object.entries(value.offers).filter(
          ([, offer]) => now - offer.createdAt <= PRUNE_AFTER_MS,
        ),
      );
      const droppedAny =
        links.length < value.links.length ||
        setRuns.length < value.setRuns.length ||
        Object.keys(offers).length < Object.keys(value.offers).length;
      if (droppedAny) {
        value = { links, setRuns, offers };
        write();
      }
      return droppedAny;
    },
  };
}

// What `text` holds, each entry of the wrong shape dropped and counted. Throws when `text` is not JSON, or its top
// level or a member is of the wrong type.
function readLinks(text: string): { value: LinksValue; dropped: number } {
  const parsed: unknown = JSON.parse(text);
  if (!isJsonObject(parsed)) {
    throw new Error('its top level is not an object');
  }
  const links = parsed.links ?? [];
  const setRuns = parsed.setRuns ?? [];
  const offers = parsed.offers ?? {};
  if (!Array.isArray(links) || !Array.isArray(setRuns)) {
    throw new Error('its links or setRuns is not a list');
  }
  if (!isJsonObject(offers)) {
    throw new Error('its offers is not an object');
  }
  const keptLinks = links.filter(isSessionLink);
  const keptSetRuns = setRuns.filter(isSetRun);
  const keptOffers = Object.fromEntries(
    Object.entries(offers).filter(([, offer]) => isBuildOffer(offer)),
  ) as Record<string, BuildOffer>;
  const dropped =
    links.length -
    keptLinks.length +
    (setRuns.length - keptSetRuns.length) +
    (Object.keys(offers).length - Object.keys(keptOffers).length);
  return {
    value: { links: keptLinks, setRuns: keptSetRuns, offers: keptOffers },
    dropped,
  };
}

type FieldCheck = (field: unknown) => boolean;

const isText: FieldCheck = (field) => typeof field === 'string';
const isTextOrNull: FieldCheck = (field) => field === null || isText(field);
const isNumber: FieldCheck = (field) => typeof field === 'number';
const isNumberOrNull: FieldCheck = (field) => field === null || isNumber(field);
const isFlag: FieldCheck = (field) => typeof field === 'boolean';
const isRefList: FieldCheck = (field) =>
  Array.isArray(field) &&
  field.every(
    (ref: unknown) =>
      isJsonObject(ref) && isText(ref.backendId) && isText(ref.buildId),
  );

function hasFields(
  value: unknown,
  checks: Record<string, FieldCheck>,
): boolean {
  return (
    isJsonObject(value) &&
    Object.entries(checks).every(([key, isValid]) => isValid(value[key]))
  );
}

function isSessionLink(value: unknown): value is SessionLink {
  return hasFields(value, {
    sessionId: isText,
    backendId: isText,
    buildId: isText,
    setRunId: isTextOrNull,
    linkedAt: isNumber,
    failingNotified: isFlag,
    notified: isFlag,
    endedAt: isNumberOrNull,
  });
}

function isSetRun(value: unknown): value is SetRun {
  return hasFields(value, {
    id: isText,
    setId: isText,
    label: isText,
    backendId: isText,
    gameId: isText,
    sessionId: isTextOrNull,
    builds: isRefList,
    revision: isTextOrNull,
    createdAt: isNumber,
    notified: isFlag,
    endedAt: isNumberOrNull,
  });
}

function isBuildOffer(value: unknown): value is BuildOffer {
  return hasFields(value, {
    backendId: isText,
    gameId: isText,
    kind: isText,
    branch: isText,
    revision: isTextOrNull,
    subject: isTextOrNull,
    createdAt: isNumber,
  });
}
