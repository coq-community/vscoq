import { promises } from "fs";
import * as path from "path";

export const isFileInFolder = async (file: string, folderPath: string) => {
  const filePath = path.join(folderPath, file);
  return await promises.access(filePath).then(
    () => true,
    () => false,
  );
};
