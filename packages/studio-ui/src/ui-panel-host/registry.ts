/**
 * 面板注册表 —— 纯 JS 类，不依赖 React，方便单测与在 Node 里跑契约套件。
 *
 * 语义与 dsh 的 slot 注册表一致：注册即认领，disposer 结束即释放；
 * 重复 id、非法声明在注册当场抛错，而不是等到渲染时才炸。
 */

import type { ContractIssue, PanelContribution } from './contract.js'
import { validateContribution } from './contract.js'

export class PanelContractError extends Error {
  constructor(
    readonly panelId: string,
    readonly issues: readonly ContractIssue[],
  ) {
    super(`panel "${panelId}" 声明非法：${issues.map((i) => `[${i.code}] ${i.message}`).join('；')}`)
    this.name = 'PanelContractError'
  }
}

export class PanelRegistry {
  private readonly map = new Map<string, PanelContribution>()

  register(contribution: PanelContribution): () => void {
    const issues = validateContribution(contribution)
    if (issues.length > 0) throw new PanelContractError(contribution.id || '<unknown>', issues)
    if (this.map.has(contribution.id)) {
      throw new PanelContractError(contribution.id, [
        { code: 'empty-id', message: `panel id 已被占用：${contribution.id}` },
      ])
    }
    this.map.set(contribution.id, contribution)
    // 幂等释放：只有仍指向本次注册的那一份才删除。
    return () => {
      if (this.map.get(contribution.id) === contribution) this.map.delete(contribution.id)
    }
  }

  get(id: string): PanelContribution | undefined {
    return this.map.get(id)
  }

  has(id: string): boolean {
    return this.map.has(id)
  }

  list(): readonly PanelContribution[] {
    return [...this.map.values()]
  }

  /** 稳定排序，供指纹与"添加面板"菜单使用。 */
  ids(): string[] {
    return [...this.map.keys()].sort()
  }

  get size(): number {
    return this.map.size
  }
}
