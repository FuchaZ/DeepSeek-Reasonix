import { createContext } from "react";

/** The rail's two scope controls travel separately: the clock and the scope's
 *  menu are placed at different ends of the header row, so the header reads
 *  one node each rather than one block it cannot take apart. */
export type RailFilter = { clock: React.ReactNode; scope: React.ReactNode };

export const RailFilterContext = createContext<RailFilter | null>(null);
