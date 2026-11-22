/** Stable work identity, independent of any single source revision. */
export interface PaperModel {
  id: string;
  title: string;
  authors: string[];
  doi: string | null;
  arxivId: string | null;
  openAlexId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
