const WORDS_PER_MINUTE = 225;

export type PostStats = {
  wordCount: number;
  readingTimeMinutes: number;
};

export type DatedContentEntry = {
  data: {
    date: string;
  };
};

type PostDateStyle = 'long' | 'short';

const POST_DATE_FORMATTERS: Record<PostDateStyle, Intl.DateTimeFormat> = {
  long: new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }),
  short: new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }),
};

function toDateTime(date: string): number {
  return new Date(date).getTime();
}

export function getPostStats(body = ''): PostStats {
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[{}#[\]>*_~|:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const wordCount = text ? text.split(' ').length : 0;

  return {
    wordCount,
    readingTimeMinutes: Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE)),
  };
}

export function formatPostStats(stats: PostStats): string {
  const wordLabel = stats.wordCount === 1 ? 'word' : 'words';
  const minuteLabel = stats.readingTimeMinutes === 1 ? 'min' : 'mins';

  return `${stats.readingTimeMinutes} ${minuteLabel} read / ${stats.wordCount} ${wordLabel}`;
}

export function formatPostDate(
  date: string,
  style: PostDateStyle = 'long',
): string {
  return POST_DATE_FORMATTERS[style].format(new Date(date));
}

export function sortEntriesByDateDesc<Entry extends DatedContentEntry>(
  entries: Entry[],
): Entry[] {
  return [...entries].sort(
    (a, b) => toDateTime(b.data.date) - toDateTime(a.data.date),
  );
}

export function groupEntriesByYear<Entry extends DatedContentEntry>(
  entries: Entry[],
): Record<string, Entry[]> {
  return entries.reduce<Record<string, Entry[]>>((groups, entry) => {
    const year = new Date(entry.data.date).getUTCFullYear().toString();
    groups[year] ??= [];
    groups[year].push(entry);
    return groups;
  }, {});
}
