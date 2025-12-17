/**
 * 设置面板组件
 * 显示缓存状态、PWA 状态等信息
 */

import { useState, useEffect } from 'react';
import { X, RefreshCw, Trash2, Database, Smartphone, CheckCircle, AlertCircle, Loader2, Download } from 'lucide-react';

// PWA 安装事件类型
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
import { useDataStore } from '@/store/dataStore';
import { useLoadingStore } from '@/store/loadingStore';

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { cacheInfo, clearCache, forceRefresh, updateCacheInfo } = useDataStore();
  const { startLoading, updateStage, finishLoading } = useLoadingStore();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pwaStatus, setPwaStatus] = useState<{
    isInstalled: boolean;
    canInstall: boolean;
    swActive: boolean;
  }>({
    isInstalled: false,
    canInstall: false,
    swActive: false,
  });
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);

  // 检查 PWA 状态
  useEffect(() => {
    // 检查是否已安装（standalone 模式）
    const isInstalled = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;

    // 检查 Service Worker 状态
    const checkSW = async () => {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        setPwaStatus(prev => ({
          ...prev,
          swActive: !!registration?.active,
        }));
      }
    };
    checkSW();

    setPwaStatus(prev => ({
      ...prev,
      isInstalled,
    }));

    // 监听 beforeinstallprompt 事件
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setPwaStatus(prev => ({
        ...prev,
        canInstall: true,
      }));
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // 监听安装完成
    window.addEventListener('appinstalled', () => {
      setPwaStatus(prev => ({
        ...prev,
        isInstalled: true,
        canInstall: false,
      }));
      setDeferredPrompt(null);
    });

    // 更新缓存信息
    updateCacheInfo();

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, [updateCacheInfo]);

  // 格式化文件大小
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // 格式化时间
  const formatDate = (timestamp: number | null): string => {
    if (!timestamp) return '从未';
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 计算下次更新时间
  const getNextUpdateText = (): string => {
    if (!cacheInfo.nextUpdate) return '需要更新';
    const now = Date.now();
    const diff = cacheInfo.nextUpdate - now;
    if (diff <= 0) return '已过期';
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    if (days > 0) return `${days} 天后`;
    return `${hours} 小时后`;
  };

  // 刷新数据
  const handleRefresh = async () => {
    setIsRefreshing(true);

    startLoading([
      { name: 'bureaus', label: '铁路局配置' },
      { name: 'zth-railway', label: '零洲铁路数据' },
      { name: 'zth-rmp', label: '零洲 RMP 数据' },
      { name: 'zth-landmark', label: '零洲地标数据' },
      { name: 'houtu-railway', label: '后土洲铁路数据' },
      { name: 'houtu-rmp', label: '后土洲 RMP 数据' },
      { name: 'houtu-landmark', label: '后土洲地标数据' },
      { name: 'naraku-railway', label: '奈落洲铁路数据' },
      { name: 'naraku-landmark', label: '奈落洲地标数据' },
      { name: 'eden-railway', label: '伊甸铁路数据' },
      { name: 'eden-landmark', label: '伊甸地标数据' },
    ]);

    await forceRefresh((stage, status) => {
      updateStage(stage, status);
    });

    setTimeout(() => {
      finishLoading();
      setIsRefreshing(false);
    }, 500);
  };

  // 清除缓存
  const handleClearCache = () => {
    if (confirm('确定要清除所有缓存数据吗？下次打开时需要重新加载。')) {
      clearCache();
      updateCacheInfo();
    }
  };

  // 安装 PWA
  const handleInstallPWA = async () => {
    if (!deferredPrompt) return;

    setIsInstalling(true);
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setPwaStatus(prev => ({
          ...prev,
          isInstalled: true,
          canInstall: false,
        }));
      }
    } finally {
      setIsInstalling(false);
      setDeferredPrompt(null);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg w-80 max-h-[80vh] overflow-hidden flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
        <h2 className="font-bold text-gray-800">设置</h2>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-200 rounded"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 数据缓存 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <Database className="w-4 h-4" />
            <span>数据缓存</span>
          </div>

          <div className="bg-gray-50 rounded-lg p-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">状态</span>
              <span className={`flex items-center gap-1 ${cacheInfo.isStale ? 'text-orange-600' : 'text-green-600'}`}>
                {cacheInfo.isStale ? (
                  <>
                    <AlertCircle className="w-3.5 h-3.5" />
                    需要更新
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-3.5 h-3.5" />
                    已缓存
                  </>
                )}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-gray-500">更新时间</span>
              <span className="text-gray-700">{formatDate(cacheInfo.lastUpdated)}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-gray-500">缓存大小</span>
              <span className="text-gray-700">{formatSize(cacheInfo.size)}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-gray-500">下次更新</span>
              <span className="text-gray-700">{getNextUpdateText()}</span>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-2">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm rounded-lg transition-colors"
            >
              {isRefreshing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span>刷新数据</span>
            </button>

            <button
              onClick={handleClearCache}
              disabled={isRefreshing}
              className="flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 text-gray-700 text-sm rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              <span>清除</span>
            </button>
          </div>
        </div>

        {/* PWA 状态 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <Smartphone className="w-4 h-4" />
            <span>PWA 状态</span>
          </div>

          <div className="bg-gray-50 rounded-lg p-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">安装状态</span>
              <span className={`flex items-center gap-1 ${pwaStatus.isInstalled ? 'text-green-600' : 'text-gray-600'}`}>
                {pwaStatus.isInstalled ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5" />
                    已安装
                  </>
                ) : (
                  '未安装'
                )}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-gray-500">Service Worker</span>
              <span className={`flex items-center gap-1 ${pwaStatus.swActive ? 'text-green-600' : 'text-gray-600'}`}>
                {pwaStatus.swActive ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5" />
                    活跃
                  </>
                ) : (
                  '未激活'
                )}
              </span>
            </div>
          </div>

          {/* 安装按钮 - 仅在可安装且未安装时显示 */}
          {pwaStatus.canInstall && !pwaStatus.isInstalled && (
            <button
              onClick={handleInstallPWA}
              disabled={isInstalling}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm rounded-lg transition-colors"
            >
              {isInstalling ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span>安装到桌面</span>
            </button>
          )}
        </div>

        {/* 关于 */}
        <div className="text-xs text-gray-400 text-center pt-2">
          <p>数据每 7 天自动更新一次</p>
          <p>也可以手动刷新获取最新数据</p>
        </div>
      </div>
    </div>
  );
}

export default SettingsPanel;
