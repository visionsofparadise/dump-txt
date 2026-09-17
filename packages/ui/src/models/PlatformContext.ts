import { createContext } from "react";
import type { Main } from "./Main";

export const PlatformContext = createContext<Main["platform"]>(undefined);
