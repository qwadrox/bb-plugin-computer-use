import { CUA_DOCS_URL } from "@/src/links";
import { TextLink } from "./shared";

const CUA_SOURCE_URL = "https://github.com/trycua/cua";

export function AboutComputerUse() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      <p>
        Desktop & Browser Agent is an independent bb integration powered by <strong className="font-medium text-foreground">Cua Driver</strong>, the open-source desktop and browser automation runtime from Cua AI, Inc.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <TextLink href={CUA_DOCS_URL}>Learn about Cua Driver</TextLink>
        <TextLink href={CUA_SOURCE_URL}>View Cua on GitHub</TextLink>
      </div>
      <p className="text-xs">This community plugin is not affiliated with or endorsed by Cua AI, Inc.</p>
    </div>
  );
}
