export type ReducedEmojiList = {
  category: string[];
  subCategory: string[][];
  keywords: string[];
  emojis: [
    emoji: string,
    name: string,
    category: number,
    subCategory: number,
    keywords: number[],
    image:
      | readonly [
          apple: 1 | 0,
          google: 1 | 0,
          twitter: 1 | 0,
          facebook: 1 | 0,
          path: string,
        ]
      | null,
  ][];
};

export type HumanReadableEmoji = {
  emoji: string;
  name: string;
  category: string;
  subcategory: string;
  keywords: string[];
  image: {
    image: string;
    apple: boolean;
    google: boolean;
    twitter: boolean;
    facebook: boolean;
  } | null;
  weight?: number;
};

export type EmojiImageArray = ReducedEmojiList["emojis"][number][5];
