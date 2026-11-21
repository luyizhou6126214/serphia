import type { RefObject } from "react";
import { HERDR_STARTABLE_AGENT_KINDS, type HerdrStartableAgentKind } from "@contract/herdr";
import { HerdrAgentIcon, herdrAgentName } from "./HerdrAgentIcon";
import { HerdrSelect } from "./HerdrSelect";

const items = HERDR_STARTABLE_AGENT_KINDS.map((kind) => ({
  value: kind,
  label: herdrAgentName(kind),
  icon: <HerdrAgentIcon kind={kind} />,
}));

interface Props {
  value: HerdrStartableAgentKind;
  onChange: (value: HerdrStartableAgentKind) => void;
  label: string;
  disabled: boolean;
  portal: RefObject<HTMLDivElement | null>;
}

export function HerdrAgentSelect(props: Props) {
  return <HerdrSelect {...props} items={items} />;
}
