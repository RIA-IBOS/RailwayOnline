/**
 * 鸟居传送逻辑
 * 处理鸟居传送点的路径规划
 */

import type { Coordinate, Torii } from '@/types';
import type { ParsedLandmark } from './landmarkParser';

// zth 特殊传送目的地
const ZTH_CENTER: Coordinate = { x: -643, y: 35, z: -1562 };    // 世界中心点
const ZTH_HAIFENG: Coordinate = { x: 8387, y: 64, z: -1304 };   // 海风湾

// 世界中心点配置
const WORLD_CENTERS: Record<string, Coordinate> = {
  zth: ZTH_CENTER,
  eden: { x: 0, y: 64, z: 0 },
  naraku: { x: 0, y: 64, z: 0 },
  houtu: { x: 0, y: 64, z: 0 },
};

/**
 * 获取鸟居传送目的地
 */
export function getTeleportDestination(toriiId: number, worldId: string): Coordinate {
  if (worldId === 'zth') {
    return toriiId <= 200 ? ZTH_CENTER : ZTH_HAIFENG;
  }
  return WORLD_CENTERS[worldId] || { x: 0, y: 64, z: 0 };
}

/**
 * 获取世界中心点
 */
export function getWorldCenter(worldId: string): Coordinate {
  return WORLD_CENTERS[worldId] || { x: 0, y: 64, z: 0 };
}

/**
 * zth 世界是否有海风湾传送（201+鸟居）
 */
export function hasHaifengTeleport(worldId: string): boolean {
  return worldId === 'zth';
}

/**
 * 获取海风湾坐标（仅 zth）
 */
export function getHaifengPoint(): Coordinate {
  return ZTH_HAIFENG;
}

/**
 * 从地标数据提取有效鸟居列表（有坐标的）
 */
export function extractToriiList(landmarks: ParsedLandmark[]): Torii[] {
  return landmarks
    .filter(landmark => landmark.coord !== null)
    .map(landmark => ({
      id: landmark.id,
      name: landmark.name,
      coord: landmark.coord!,
    }));
}

/**
 * 计算两点距离
 */
function getDistance(a: Coordinate, b: Coordinate): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * 找到距离某点最近的鸟居
 */
export function findNearestTorii(
  coord: Coordinate,
  toriiList: Torii[]
): Torii | null {
  if (toriiList.length === 0) return null;

  let nearest = toriiList[0];
  let minDist = getDistance(coord, toriiList[0].coord);

  for (const torii of toriiList) {
    const dist = getDistance(coord, torii.coord);
    if (dist < minDist) {
      minDist = dist;
      nearest = torii;
    }
  }

  return nearest;
}

/**
 * 找到距离某点最近且满足条件的鸟居
 */
export function findNearestToriiWithFilter(
  coord: Coordinate,
  toriiList: Torii[],
  filter: (torii: Torii) => boolean
): Torii | null {
  const filtered = toriiList.filter(filter);
  return findNearestTorii(coord, filtered);
}

// 传送路径段
export interface TeleportSegment {
  type: 'walk_to_torii' | 'teleport' | 'walk_from_teleport';
  from: Coordinate;
  to: Coordinate;
  distance: number;
  torii?: Torii;           // 传送时使用的鸟居
  destinationName?: string; // 传送目的地名称
}

// 传送路径结果
export interface TeleportPathResult {
  found: boolean;
  segments: TeleportSegment[];
  totalWalkDistance: number;
  teleportCount: number;
}

/**
 * 计算传送路径
 * 策略：找到最优的传送方案（可能需要0-2次传送）
 * 支持双向传送：鸟居→中转点，中转点→鸟居
 */
export function findTeleportPath(
  start: Coordinate,
  end: Coordinate,
  toriiList: Torii[],
  worldId: string
): TeleportPathResult {
  if (toriiList.length === 0) {
    return {
      found: false,
      segments: [],
      totalWalkDistance: getDistance(start, end),
      teleportCount: 0,
    };
  }

  const directWalkDistance = getDistance(start, end);

  // 方案1：直接步行（不使用传送）
  let bestResult: TeleportPathResult = {
    found: true,
    segments: [{
      type: 'walk_to_torii',
      from: start,
      to: end,
      distance: directWalkDistance,
    }],
    totalWalkDistance: directWalkDistance,
    teleportCount: 0,
  };

  // 找起点和终点最近的鸟居
  const nearestToStart = findNearestTorii(start, toriiList);
  const nearestToEnd = findNearestTorii(end, toriiList);

  // 方案2：使用一次传送（任意位置直接传送到中转点 → 步行到终点）
  // 注意：正向传送可以在任意位置进行，不需要先走到鸟居
  if (nearestToStart) {
    const dest = getTeleportDestination(nearestToStart.id, worldId);
    const walkFromDest = getDistance(dest, end);
    const totalWalk = walkFromDest;  // 只需要从中转点步行到终点

    if (totalWalk < bestResult.totalWalkDistance) {
      bestResult = {
        found: true,
        segments: [
          {
            type: 'teleport',
            from: start,
            to: dest,
            distance: 0,
            torii: nearestToStart,
            destinationName: worldId === 'zth' ? (nearestToStart.id <= 200 ? '世界中心' : '海风湾') : '世界中心',
          },
          {
            type: 'walk_from_teleport',
            from: dest,
            to: end,
            distance: walkFromDest,
          },
        ],
        totalWalkDistance: totalWalk,
        teleportCount: 1,
      };
    }
  }

  // 方案3：使用两次传送（任意位置传送到中转点 → 反向传送到终点附近鸟居）
  // 正向传送可以在任意位置进行，不需要先走到鸟居
  if (nearestToStart && nearestToEnd) {
    const startDest = getTeleportDestination(nearestToStart.id, worldId);
    const endDest = getTeleportDestination(nearestToEnd.id, worldId);

    const walkFromEndTorii = getDistance(nearestToEnd.coord, end);

    // 判断两个鸟居的传送目的地是否相同
    const sameDest = startDest.x === endDest.x && startDest.z === endDest.z;

    if (sameDest) {
      // 同一中转点：起点直接传送→D→B→终点（2次传送，只需要最后一段步行）
      const totalWalk = walkFromEndTorii;

      if (totalWalk < bestResult.totalWalkDistance) {
        const destName = worldId === 'zth'
          ? (nearestToStart.id <= 200 ? '世界中心' : '海风湾')
          : '世界中心';

        bestResult = {
          found: true,
          segments: [
            {
              type: 'teleport',
              from: start,
              to: startDest,
              distance: 0,
              torii: nearestToStart,
              destinationName: destName,
            },
            {
              type: 'teleport',
              from: startDest,
              to: nearestToEnd.coord,
              distance: 0,
              torii: nearestToEnd,
              destinationName: nearestToEnd.name,
            },
            {
              type: 'walk_from_teleport',
              from: nearestToEnd.coord,
              to: end,
              distance: walkFromEndTorii,
            },
          ],
          totalWalkDistance: totalWalk,
          teleportCount: 2,
        };
      }
    } else {
      // 不同中转点：起点直接传送→D1→步行到D2→B→终点（2次传送+中间步行）
      // 正向传送不需要走到鸟居
      const walkBetweenDests = getDistance(startDest, endDest);
      const totalWalk = walkBetweenDests + walkFromEndTorii;

      if (totalWalk < bestResult.totalWalkDistance) {
        const startDestName = worldId === 'zth'
          ? (nearestToStart.id <= 200 ? '世界中心' : '海风湾')
          : '世界中心';

        bestResult = {
          found: true,
          segments: [
            {
              type: 'teleport',
              from: start,
              to: startDest,
              distance: 0,
              torii: nearestToStart,
              destinationName: startDestName,
            },
            {
              type: 'walk_to_torii',
              from: startDest,
              to: endDest,
              distance: walkBetweenDests,
            },
            {
              type: 'teleport',
              from: endDest,
              to: nearestToEnd.coord,
              distance: 0,
              torii: nearestToEnd,
              destinationName: nearestToEnd.name,
            },
            {
              type: 'walk_from_teleport',
              from: nearestToEnd.coord,
              to: end,
              distance: walkFromEndTorii,
            },
          ],
          totalWalkDistance: totalWalk,
          teleportCount: 2,
        };
      }
    }
  }

  // 方案4：zth 世界特殊方案 - 利用世界中心和海风湾中转
  // 这些方案涉及跨中转点，需要步行到中转点附近的鸟居
  if (worldId === 'zth') {
    // 4a: 任意位置传送到世界中心 → 走到世界中心附近201+鸟居 → 海风湾 → 步行
    const toriiNearCenter201 = findNearestToriiWithFilter(
      ZTH_CENTER,
      toriiList,
      t => t.id > 200
    );

    if (toriiNearCenter201) {
      const nearestToStart1_200 = findNearestToriiWithFilter(
        start,
        toriiList,
        t => t.id <= 200
      );

      if (nearestToStart1_200) {
        const walkCenterToTorii2 = getDistance(ZTH_CENTER, toriiNearCenter201.coord);
        const walkFromHaifeng = getDistance(ZTH_HAIFENG, end);
        const totalWalk = walkCenterToTorii2 + walkFromHaifeng;

        if (totalWalk < bestResult.totalWalkDistance) {
          bestResult = {
            found: true,
            segments: [
              {
                type: 'teleport',
                from: start,
                to: ZTH_CENTER,
                distance: 0,
                torii: nearestToStart1_200,
                destinationName: '世界中心',
              },
              {
                type: 'walk_to_torii',
                from: ZTH_CENTER,
                to: toriiNearCenter201.coord,
                distance: walkCenterToTorii2,
                torii: toriiNearCenter201,
              },
              {
                type: 'teleport',
                from: toriiNearCenter201.coord,
                to: ZTH_HAIFENG,
                distance: 0,
                torii: toriiNearCenter201,
                destinationName: '海风湾',
              },
              {
                type: 'walk_from_teleport',
                from: ZTH_HAIFENG,
                to: end,
                distance: walkFromHaifeng,
              },
            ],
            totalWalkDistance: totalWalk,
            teleportCount: 2,
          };
        }
      }
    }

    // 4b: 任意位置传送到海风湾 → 走到海风湾附近1-200鸟居 → 世界中心 → 步行
    const toriiNearHaifeng1_200 = findNearestToriiWithFilter(
      ZTH_HAIFENG,
      toriiList,
      t => t.id <= 200
    );

    if (toriiNearHaifeng1_200) {
      const nearestToStart201 = findNearestToriiWithFilter(
        start,
        toriiList,
        t => t.id > 200
      );

      if (nearestToStart201) {
        const walkHaifengToTorii2 = getDistance(ZTH_HAIFENG, toriiNearHaifeng1_200.coord);
        const walkFromCenter = getDistance(ZTH_CENTER, end);
        const totalWalk = walkHaifengToTorii2 + walkFromCenter;

        if (totalWalk < bestResult.totalWalkDistance) {
          bestResult = {
            found: true,
            segments: [
              {
                type: 'teleport',
                from: start,
                to: ZTH_HAIFENG,
                distance: 0,
                torii: nearestToStart201,
                destinationName: '海风湾',
              },
              {
                type: 'walk_to_torii',
                from: ZTH_HAIFENG,
                to: toriiNearHaifeng1_200.coord,
                distance: walkHaifengToTorii2,
                torii: toriiNearHaifeng1_200,
              },
              {
                type: 'teleport',
                from: toriiNearHaifeng1_200.coord,
                to: ZTH_CENTER,
                distance: 0,
                torii: toriiNearHaifeng1_200,
                destinationName: '世界中心',
              },
              {
                type: 'walk_from_teleport',
                from: ZTH_CENTER,
                to: end,
                distance: walkFromCenter,
              },
            ],
            totalWalkDistance: totalWalk,
            teleportCount: 2,
          };
        }
      }
    }

    // 4c: 任意位置传送到世界中心 → 反向传送到终点附近1-200鸟居
    if (nearestToEnd && nearestToEnd.id <= 200) {
      const nearestToStart1_200_c = findNearestToriiWithFilter(
        start,
        toriiList,
        t => t.id <= 200
      );

      if (nearestToStart1_200_c) {
        const walkFromEndTorii = getDistance(nearestToEnd.coord, end);
        const totalWalk = walkFromEndTorii;

        if (totalWalk < bestResult.totalWalkDistance) {
          bestResult = {
            found: true,
            segments: [
              {
                type: 'teleport',
                from: start,
                to: ZTH_CENTER,
                distance: 0,
                torii: nearestToStart1_200_c,
                destinationName: '世界中心',
              },
              {
                type: 'teleport',
                from: ZTH_CENTER,
                to: nearestToEnd.coord,
                distance: 0,
                torii: nearestToEnd,
                destinationName: nearestToEnd.name,
              },
              {
                type: 'walk_from_teleport',
                from: nearestToEnd.coord,
                to: end,
                distance: walkFromEndTorii,
              },
            ],
            totalWalkDistance: totalWalk,
            teleportCount: 2,
          };
        }
      }
    }

    // 4d: 任意位置传送到海风湾 → 反向传送到终点附近201+鸟居
    if (nearestToEnd && nearestToEnd.id > 200) {
      const nearestToStart201_d = findNearestToriiWithFilter(
        start,
        toriiList,
        t => t.id > 200
      );

      if (nearestToStart201_d) {
        const walkFromEndTorii = getDistance(nearestToEnd.coord, end);
        const totalWalk = walkFromEndTorii;

        if (totalWalk < bestResult.totalWalkDistance) {
          bestResult = {
            found: true,
            segments: [
              {
                type: 'teleport',
                from: start,
                to: ZTH_HAIFENG,
                distance: 0,
                torii: nearestToStart201_d,
                destinationName: '海风湾',
              },
              {
                type: 'teleport',
                from: ZTH_HAIFENG,
                to: nearestToEnd.coord,
                distance: 0,
                torii: nearestToEnd,
                destinationName: nearestToEnd.name,
              },
              {
                type: 'walk_from_teleport',
                from: nearestToEnd.coord,
                to: end,
                distance: walkFromEndTorii,
              },
            ],
            totalWalkDistance: totalWalk,
            teleportCount: 2,
          };
        }
      }
    }
  }

  return bestResult;
}

/**
 * 简化传送路径结果（合并相邻的步行段）
 */
export function simplifyTeleportPath(result: TeleportPathResult): TeleportPathResult {
  if (result.segments.length <= 1) return result;

  const simplified: TeleportSegment[] = [];
  let currentWalk: TeleportSegment | null = null;

  for (const segment of result.segments) {
    if (segment.type === 'teleport') {
      if (currentWalk) {
        simplified.push(currentWalk);
        currentWalk = null;
      }
      simplified.push(segment);
    } else {
      // 步行段
      if (currentWalk) {
        // 合并步行
        currentWalk.to = segment.to;
        currentWalk.distance += segment.distance;
      } else {
        currentWalk = { ...segment };
      }
    }
  }

  if (currentWalk) {
    simplified.push(currentWalk);
  }

  return {
    ...result,
    segments: simplified,
  };
}
