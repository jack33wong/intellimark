/**
 * Block Clustering Service
 * Handles block clustering and merging operations
 */

import type { protos } from '@google-cloud/vision';

// Type aliases for robust recognition
type IBlock = protos.google.cloud.vision.v1.IBlock;
type IVertex = protos.google.cloud.vision.v1.IVertex;

export interface DetectedBlock {
  source: string;
  blockIndex: number;
  text?: string | null;
  confidence?: number | null;
  geometry: {
    width: number;
    height: number;
    boundingBox: IVertex[];
    minX: number;
    minY: number;
  };
}

export class BlockClusteringService {
  /**
   * Merge overlapping blocks into unified clusters. Uses simple rectangle intersection.
   * Repeats until no merges occur or a safety iteration cap is reached.
   */
  static mergeOverlappingBlocks(blocks: DetectedBlock[]): DetectedBlock[] {
    const intersects = (a: DetectedBlock, b: DetectedBlock): boolean => {
      const ax1 = a.geometry.minX;
      const ay1 = a.geometry.minY;
      const ax2 = a.geometry.minX + a.geometry.width;
      const ay2 = a.geometry.minY + a.geometry.height;
      const bx1 = b.geometry.minX;
      const by1 = b.geometry.minY;
      const bx2 = b.geometry.minX + b.geometry.width;
      const by2 = b.geometry.minY + b.geometry.height;
      return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
    };

    const mergeTwo = (a: DetectedBlock, b: DetectedBlock): DetectedBlock => {
      const minX = Math.min(a.geometry.minX, b.geometry.minX);
      const minY = Math.min(a.geometry.minY, b.geometry.minY);
      const maxX = Math.max(a.geometry.minX + a.geometry.width, b.geometry.minX + b.geometry.width);
      const maxY = Math.max(a.geometry.minY + a.geometry.height, b.geometry.minY + b.geometry.height);
      const mergedWidth = Math.round(maxX - minX);
      const mergedHeight = Math.round(maxY - minY);
      const text = [a.text || '', b.text || ''].filter(Boolean).join(' ').trim();
      const confidence = (((a.confidence || 0) + (b.confidence || 0)) / (2)) || 0;
      return {
        source: `${a.source}|${b.source}|merged`,
        blockIndex: Math.min(a.blockIndex, b.blockIndex),
        text,
        confidence,
        geometry: {
          width: mergedWidth,
          height: mergedHeight,
          boundingBox: [
            { x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }
          ],
          minX,
          minY
        }
      } as DetectedBlock;
    };

    // Work on a copy
    let current = [...blocks];
    let changed = true;
    let iterations = 0;
    const MAX_ITERATIONS = 20;
    while (changed && iterations < MAX_ITERATIONS) {
      changed = false;
      iterations++;
      const result: DetectedBlock[] = [];
      const used = new Set<number>();
      for (let i = 0; i < current.length; i++) {
        if (used.has(i)) continue;
        let mergedBlock = current[i];
        for (let j = i + 1; j < current.length; j++) {
          if (used.has(j)) continue;
          if (intersects(mergedBlock, current[j])) {
            mergedBlock = mergeTwo(mergedBlock, current[j]);
            used.add(j);
            changed = true;
          }
        }
        used.add(i);
        result.push(mergedBlock);
      }
      current = result;
    }
    // Reindex blockIndex for stability
    current.forEach((b, idx) => (b.blockIndex = idx + 1));
    return current;
  }

  /**
   * Perform DBSCAN clustering on detected blocks
   */
  static async performDBSCANClustering(
    allBlocks: DetectedBlock[],
    dbscanEpsPx: number,
    dbscanMinPts: number
  ): Promise<{ finalBlocks: DetectedBlock[]; preClusterBlocks: DetectedBlock[] }> {
    // Keep a copy of raw detected blocks prior to clustering for visualization/debugging
    const preClusterBlocks: DetectedBlock[] = allBlocks.slice();

    // Cluster results using DBSCAN (center-point clustering)
    const { DBSCAN } = await import('density-clustering') as unknown as { DBSCAN: new () => any };
    const algo: any = new (DBSCAN as any)();

    const points: Array<[number, number]> = allBlocks.map(b => [
      b.geometry.minX + b.geometry.width / 2,
      b.geometry.minY + b.geometry.height / 2
    ]);

    const clusters: number[][] = algo.run(points, dbscanEpsPx, dbscanMinPts);
    const noise: number[] = algo.noise || [];

    const finalBlocks: DetectedBlock[] = [];

    // Convert clusters to merged blocks
    clusters.forEach((idxs, clusterIdx) => {
      if (!Array.isArray(idxs) || idxs.length === 0) return;
      const members = idxs.map(i => allBlocks[i]);

      const minX = Math.min(...members.map(m => m.geometry.minX));
      const minY = Math.min(...members.map(m => m.geometry.minY));
      const maxX = Math.max(...members.map(m => m.geometry.minX + m.geometry.width));
      const maxY = Math.max(...members.map(m => m.geometry.minY + m.geometry.height));

      const mergedWidth = Math.round(maxX - minX);
      const mergedHeight = Math.round(maxY - minY);

      const text = members
        .slice()
        .sort((a, b) => (a.geometry.minY - b.geometry.minY) || (a.geometry.minX - b.geometry.minX))
        .map(m => (m.text || '').trim())
        .filter(Boolean)
        .join(' ');

      const avgConfidence = members.reduce((sum, m) => sum + (m.confidence || 0), 0) / members.length;

      finalBlocks.push({
        source: 'dbscan_cluster',
        blockIndex: clusterIdx + 1,
        text,
        confidence: avgConfidence,
        geometry: {
          width: mergedWidth,
          height: mergedHeight,
          boundingBox: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }],
          minX,
          minY
        }
      });
    });

    // Include noise points as individual blocks (optional but useful)
    noise.forEach((i, nIdx) => {
      const b = allBlocks[i];
      finalBlocks.push({
        ...b,
        source: `${b.source}|noise`
      });
    });

    finalBlocks.forEach((block, index) => block.blockIndex = index + 1);

    // Post-process: merge overlapping cluster boxes for cleaner regions
    const mergedClusters = this.mergeOverlappingBlocks(finalBlocks);

    return { finalBlocks: mergedClusters, preClusterBlocks };
  }
}
