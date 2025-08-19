import { ReactElement, useMemo, useState } from "react";
import { ActionPanel, Grid } from "@project-gauntlet/api/components";
import { usePromise } from "@project-gauntlet/api/hooks";
import { assetData, Clipboard } from "@project-gauntlet/api/helpers";
import { EmojiSearcher } from "./search-emoji";
import { throttle } from "lodash";
import type { HumanReadableEmoji, ReducedEmojiList } from "./type";

async function readGzippedJson<T>(path: string) {
  const data = await assetData(path);
  const ds = new DecompressionStream("gzip");
  const blob = new Blob([data]);
  const decompressedStream = blob.stream().pipeThrough(ds);
  const res = await new Response(decompressedStream).text();
  return JSON.parse(res) as T;
}

function readReducedEmojiList() {
  return readGzippedJson<ReducedEmojiList>("reduced-emoji.gz");
}

function useEmojiSearcher() {
  const { data: emojiList } = usePromise(readReducedEmojiList);

  const searcher = useMemo(() => {
    if (!emojiList) return null;
    return new EmojiSearcher(emojiList);
  }, [emojiList]);

  return searcher;
}

const throttledSearch = throttle(
  (
    input: string | null | undefined,
    searcher: EmojiSearcher,
    update: (e: HumanReadableEmoji[] | null) => void,
    onFlush: () => void,
  ) => {
    input = input?.trim();
    if (!input) {
      update(null);
    } else {
      update(searcher.search(input).slice(0, 64));
    }
    onFlush();
  },
  25,
  {
    leading: false,
    trailing: true,
  },
);

export default function EmojiSelector(): ReactElement {
  const searcher = useEmojiSearcher();
  const [filteredEmoji, setFilteredEmoji] = useState<
    HumanReadableEmoji[] | null
  >(null);
  const [isSearching, setIsSearching] = useState(false);

  const commonEmoji = useMemo(() => searcher?.getCommon() || [], [searcher]);
  const display = filteredEmoji || commonEmoji;

  return (
    <Grid
      isLoading={!searcher}
      columns={8}
      actions={
        <ActionPanel>
          <ActionPanel.Action
            label={"Copy to clipboard"}
            onAction={async (emoji) => {
              if (!emoji) return;
              await Clipboard.writeText(emoji);
              return { close: true };
            }}
          />
          <ActionPanel.Action
            label={"Copy image to clipboard"}
            onAction={async (emoji) => {
              if (!emoji) return;
              const emojiData = display.find((e) => e.emoji === emoji);
              const emojiPath = emojiData && getImagePath(emojiData);
              if (emojiPath) {
                await Clipboard.write({
                  "image/png": await assetData(emojiPath),
                });
              } else {
                await Clipboard.writeText(emoji);
              }
              return { close: true };
            }}
          />
        </ActionPanel>
      }
    >
      <Grid.SearchBar
        placeholder="Search for emoji..."
        onChange={(v) => {
          if (!searcher) return;
          setIsSearching(true);
          throttledSearch(v, searcher, setFilteredEmoji, () =>
            setIsSearching(false),
          );
        }}
      />
      {!searcher && (
        <Grid.EmptyView
          title="Hold on tight!"
          description="Grabbing all the emojis just for you..."
          image={{ asset: "icon.png" }}
        />
      )}
      {/* placeholder items shown while searching to force image reload */}
      {isSearching &&
        new Array(24).fill(null).map((_, i) => (
          <Grid.Item id={`placeholder-${i}`} key={i}>
            <Grid.Item.Content>
              <Grid.Item.Content.H1 />
            </Grid.Item.Content>
          </Grid.Item>
        ))}
      {!isSearching &&
        display.map((value) => (
          <Grid.Item id={value.emoji} key={value.emoji} title={value.name}>
            <Grid.Item.Content>
              <EmojiDisplay emoji={value} />
            </Grid.Item.Content>
          </Grid.Item>
        ))}
    </Grid>
  );
}

function getImagePath(emoji: HumanReadableEmoji) {
  if (!emoji.image) return null;
  if (Deno.build.os === "darwin" && emoji.image.apple) {
    return `img-apple-64/${emoji.image.image}`;
  }
  if (emoji.image.google) {
    return `img-google-64/${emoji.image.image}`;
  }
  return null;
}

function EmojiDisplay({
  emoji,
  forceFontRendering,
}: {
  emoji: HumanReadableEmoji;
  forceFontRendering?: boolean;
}) {
  const imgPath = getImagePath(emoji);
  if (!imgPath || forceFontRendering)
    return <Grid.Item.Content.H1>{emoji.emoji}</Grid.Item.Content.H1>;

  return <Grid.Item.Content.Image source={{ asset: imgPath }} />;
}
