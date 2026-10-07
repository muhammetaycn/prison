"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface HandoffTask {
  goal?: string;
  rawRequest?: string;
  taskType?: string;
  deliverables?: string[];
  successCriteria?: string[];
}

const Context = createContext<HandoffTask | undefined>(undefined);

/** Task from the version currently on screen, so older prompts keep their own instructions. */
export function HandoffTaskProvider({ value, children }: { value: HandoffTask; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useHandoffTask() { return useContext(Context); }
