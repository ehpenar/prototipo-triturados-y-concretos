import { createContext, useContext } from "react";

export const OperationalOpsContext = createContext(null);

export function useOperationalOpsData() {
  return useContext(OperationalOpsContext);
}
