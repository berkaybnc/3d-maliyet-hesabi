import React, { useState, useEffect, useCallback } from 'react';
import { 
  Calculator, Zap, Box, Clock, Banknote, Printer, 
  Save, History, Hammer, TrendingUp, AlertTriangle, 
  Trash2, Package, List, UploadCloud, CheckCircle, Plus
} from 'lucide-react';

// Özel Local Storage Kancası (Hook)
function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      return initialValue;
    }
  });

  const setValue = (value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.log(error);
    }
  };
  return [storedValue, setValue];
}

// --- GCODE PARSER ---
const parseGcode = (text) => {
  let timeHours = 0;
  let weight = 0;

  // --- TIME PARSING ---
  // Regex looks for words like time, süre, zaman, printing followed by = or : and extracts days, hours, mins, secs.
  const hmTimeMatch = text.match(/;[^;\r\n]*(?:time|süre|zaman|printing|baskı|tahmini)[^;\r\n]*[=:]\s*(?:(\d+)\s*d\s*)?(?:(\d+)\s*h\s*)?(?:(\d+)\s*m\s*)?(?:(\d+)\s*s\s*)?/i);
  if (hmTimeMatch && (hmTimeMatch[1] || hmTimeMatch[2] || hmTimeMatch[3] || hmTimeMatch[4])) {
    const d = parseInt(hmTimeMatch[1] || 0);
    const h = parseInt(hmTimeMatch[2] || 0);
    const m = parseInt(hmTimeMatch[3] || 0);
    const s = parseInt(hmTimeMatch[4] || 0);
    timeHours = (d * 24) + h + (m / 60) + (s / 3600);
  } else {
    // Look for generic time in seconds (e.g., ;TIME:21600 or ; time_elapsed: 21600)
    const secTimeMatch = text.match(/;[^;\r\n]*(?:time|süre|zaman)[^;\r\n]*[=:]\s*(\d+(?:\.\d+)?)\s*(?!d|h|m|s)/i);
    if (secTimeMatch) {
      timeHours = parseFloat(secTimeMatch[1]) / 3600;
    } else {
      // Fallback: M73 P0 R(\d+) remaining time in minutes
      const m73Match = text.match(/M73\s+P0\s+R(\d+)/i);
      if (m73Match) {
        timeHours = parseInt(m73Match[1]) / 60;
      }
    }
  }

  // --- WEIGHT PARSING ---
  // Try to find explicit weight in grams: (e.g. filament used [g] = 12.34 or weight: 12.34 or mass = 12.34)
  const weightMatchG = text.match(/;[^;\r\n]*(?:weight|mass|gram|ağırlık|\[g\]|g\])[^;\r\n]*[=:]\s*([\d.]+)/i);
  if (weightMatchG) {
    weight = parseFloat(weightMatchG[1]);
  } else {
    // Cura format: ;Filament used: 12.34m, 5.67g
    const curaWeightMatch = text.match(/Filament used:.*,\s*([\d.]+)g/i);
    if (curaWeightMatch) {
      weight = parseFloat(curaWeightMatch[1]);
    } else {
      // Fallback: Try to find filament length (m) and calculate weight from density/diameter
      const lengthMatch = text.match(/;[^;\r\n]*(?:length|uzunluk|\[m\]|m\]|filament used)[^;\r\n]*[=:]\s*([\d.]+)\s*m/i);
      if (lengthMatch) {
        const lengthM = parseFloat(lengthMatch[1]);
        
        // Find density (g/cm3), default 1.24
        const densityMatch = text.match(/filament_density\s*[=:]\s*([\d.]+)/i);
        const density = densityMatch ? parseFloat(densityMatch[1]) : 1.24;
        
        // Find diameter (mm), default 1.75
        const diameterMatch = text.match(/filament_diameter\s*[=:]\s*([\d.]+)/i);
        const diameter = diameterMatch ? parseFloat(diameterMatch[1]) : 1.75;
        
        const radiusCm = (diameter / 2) / 10;
        const lengthCm = lengthM * 100;
        const volumeCm3 = Math.PI * (radiusCm * radiusCm) * lengthCm;
        weight = volumeCm3 * density;
      }
    }
  }

  return { timeHours, weight };
};


function App() {
  const [activeTab, setActiveTab] = useState('calculator'); // calculator, inventory, orders

  // --- STOK (ENVERTER) ---
  const [inventory, setInventory] = useLocalStorage('cfg_inventory', []);
  
  // --- SİPARİŞLER ---
  const [orders, setOrders] = useLocalStorage('cfg_orders', []);

  // --- AYARLAR ---
  const [electricityPrice, setElectricityPrice] = useLocalStorage('cfg_electricityPrice', 3);
  const [amortization, setAmortization] = useLocalStorage('cfg_amortization', 5);
  const [hourlyLaborRate, setHourlyLaborRate] = useLocalStorage('cfg_hourlyLaborRate', 100);
  const [failureRate, setFailureRate] = useLocalStorage('cfg_failureRate', 5);
  const [profitMargin, setProfitMargin] = useLocalStorage('cfg_profitMargin', 50);

  // --- HESAPLAMA EKRANI DURUMLARI ---
  const [selectedFilamentId, setSelectedFilamentId] = useState('');
  const [printTime, setPrintTime] = useState('');
  const [filamentUsed, setFilamentUsed] = useState('');
  const [laborTime, setLaborTime] = useState('');
  
  const [saveName, setSaveName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // GCODE Yükleme İşlemi
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.gcode') || file.name.endsWith('.bgcode'))) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target.result;
        // Limit text to avoid parsing gigabytes, markers are usually at top or bottom.
        // We take first 100kb and last 100kb
        let contentToParse = text;
        if(text.length > 2000000) {
          contentToParse = text.substring(0, 1000000) + "\n" + text.substring(text.length - 1000000);
        }
        
        const { timeHours, weight } = parseGcode(contentToParse);
        if (timeHours > 0) setPrintTime(timeHours.toFixed(2));
        if (weight > 0) setFilamentUsed(weight.toFixed(1));
      };
      reader.readAsText(file);
    }
  };


  // Hesaplamalar
  const activeFilament = inventory.find(i => i.id === selectedFilamentId);
  const activePricePerKg = activeFilament ? activeFilament.pricePerKg : 0;

  const pPrintTime = parseFloat(printTime) || 0;
  const pFilamentUsed = parseFloat(filamentUsed) || 0;
  const pLaborTime = parseFloat(laborTime) || 0; 
  const pLaborRate = parseFloat(hourlyLaborRate) || 0; 
  const pElecPrice = parseFloat(electricityPrice) || 0;
  const pAmort = parseFloat(amortization) || 0;
  const pFailure = parseFloat(failureRate) || 0;
  const pProfit = parseFloat(profitMargin) || 0;

  const materialCost = pFilamentUsed * (activePricePerKg / 1000);
  const electricityCost = pPrintTime * 0.7 * pElecPrice;
  const amortizationCost = pPrintTime * pAmort;
  const laborCost = (pLaborTime / 60) * pLaborRate;

  const baseCost = materialCost + electricityCost + amortizationCost + laborCost;
  const failureCost = baseCost * (pFailure / 100);
  const totalNetCost = baseCost + failureCost;
  const profitAmount = totalNetCost * (pProfit / 100);
  const salePrice = totalNetCost + profitAmount;

  // Sipariş Oluşturma
  const handleCreateOrder = () => {
    if (!saveName.trim() || totalNetCost <= 0) return;
    const newOrder = {
      id: Date.now(),
      customer: customerName || 'Bilinmeyen Müşteri',
      product: saveName,
      filamentId: selectedFilamentId,
      weight: pFilamentUsed,
      cost: totalNetCost,
      salePrice: salePrice,
      status: 'Bekliyor', // Bekliyor, Baskıda, Tamamlandı
      dueDate: dueDate || '-',
      date: new Date().toLocaleDateString('tr-TR')
    };
    setOrders([newOrder, ...orders]);
    setSaveName('');
    setCustomerName('');
    setDueDate('');
    setActiveTab('orders'); // Siparişler sekmesine at
  };

  const handleUpdateOrderStatus = (orderId, newStatus) => {
    setOrders(orders.map(o => {
      if (o.id === orderId) {
        // Eğer Tamamlandı'ya geçiyorsa stoktan düş
        if (newStatus === 'Tamamlandı' && o.status !== 'Tamamlandı' && o.filamentId) {
          deductInventory(o.filamentId, o.weight);
        }
        return { ...o, status: newStatus };
      }
      return o;
    }));
  };

  const deductInventory = (id, amount) => {
    setInventory(prev => prev.map(inv => {
      if(inv.id === id) {
        return { ...inv, weight: Math.max(0, inv.weight - amount) };
      }
      return inv;
    }));
  };

  const handleDeleteOrder = (id) => {
    setOrders(orders.filter(o => o.id !== id));
  };

  // --- STOK SEKME İŞLEMLERİ ---
  const [newInv, setNewInv] = useState({ brand: '', color: '', material: 'PLA', weight: 1000, pricePerKg: 600 });
  const handleAddInventory = () => {
    if(!newInv.brand || !newInv.color) return;
    setInventory([...inventory, { ...newInv, id: Date.now().toString() }]);
    setNewInv({ brand: '', color: '', material: 'PLA', weight: 1000, pricePerKg: 600 });
  };
  const handleDeleteInventory = (id) => {
    setInventory(inventory.filter(i => i.id !== id));
    if(selectedFilamentId === id) setSelectedFilamentId('');
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 flex flex-col font-sans selection:bg-blue-500/30">
      
      {/* HEADER & NAV */}
      <div className="bg-gray-900 border-b border-gray-800 p-4 shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg">
              <Printer className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-white">3D Stüdyo Asistanı</h1>
          </div>
          
          <div className="flex bg-gray-950 p-1 rounded-lg border border-gray-800 overflow-x-auto w-full md:w-auto">
            <button 
              onClick={() => setActiveTab('calculator')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm transition-colors ${activeTab === 'calculator' ? 'bg-gray-800 text-blue-400' : 'text-gray-400 hover:text-white'}`}
            >
              <Calculator className="w-4 h-4" /> Hesaplama
            </button>
            <button 
              onClick={() => setActiveTab('inventory')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm transition-colors ${activeTab === 'inventory' ? 'bg-gray-800 text-orange-400' : 'text-gray-400 hover:text-white'}`}
            >
              <Package className="w-4 h-4" /> Stok
            </button>
            <button 
              onClick={() => setActiveTab('orders')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm transition-colors ${activeTab === 'orders' ? 'bg-gray-800 text-purple-400' : 'text-gray-400 hover:text-white'}`}
            >
              <List className="w-4 h-4" /> Siparişler
            </button>
          </div>
        </div>
      </div>

      {/* İÇERİK ALANI */}
      <div className="flex-1 overflow-auto p-4 lg:p-8">
        <div className="max-w-7xl mx-auto h-full">

          {/* 1. HESAPLAMA SEKMESİ */}
          {activeTab === 'calculator' && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
              {/* SOL YAN */}
              <div className="xl:col-span-8 space-y-6">
                
                {/* GCODE Drop Area */}
                <div 
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center transition-all ${isDragging ? 'border-blue-400 bg-blue-900/20' : 'border-gray-700 bg-gray-900/50 hover:border-gray-600'}`}
                >
                  <UploadCloud className={`w-12 h-12 mb-3 ${isDragging ? 'text-blue-400' : 'text-gray-500'}`} />
                  <p className="text-gray-300 font-medium">.gcode dosyanızı buraya sürükleyin</p>
                  <p className="text-gray-500 text-sm mt-1">Süre ve harcanan filament otomatik okunur</p>
                </div>

                {/* Ayarlar ve Girdiler */}
                <div className="bg-gray-900/50 rounded-2xl p-6 border border-gray-800 shadow-xl">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-6 pb-6 border-b border-gray-800">
                    <div className="space-y-2 sm:col-span-3">
                      <label className="text-sm font-medium text-gray-400 flex items-center gap-2">
                        <Package className="w-4 h-4" /> Kullanılan Filament (Stoktan)
                      </label>
                      <select 
                        value={selectedFilamentId}
                        onChange={(e) => setSelectedFilamentId(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">-- Stoktan Filament Seçin --</option>
                        {inventory.map(i => (
                          <option key={i.id} value={i.id}>{i.brand} {i.color} {i.material} ({i.pricePerKg} ₺/kg) - {i.weight}g kaldı</option>
                        ))}
                      </select>
                      {inventory.length === 0 && <p className="text-xs text-orange-400 mt-1">Önce Stok sekmesinden filament ekleyin!</p>}
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Baskı Süresi (Saat)</label>
                      <input type="number" value={printTime} onChange={(e) => setPrintTime(e.target.value)} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-2.5 text-white" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Harcanan Filament (g)</label>
                      <input type="number" value={filamentUsed} onChange={(e) => setFilamentUsed(e.target.value)} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-2.5 text-white" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Harcanan İşçilik (Dk)</label>
                      <input type="number" value={laborTime} onChange={(e) => setLaborTime(e.target.value)} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-2.5 text-white" />
                    </div>
                  </div>

                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Sabit Ayarlar</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs text-gray-400">Elektrik (₺/kWh)</label>
                      <input type="number" value={electricityPrice} onChange={(e) => setElectricityPrice(e.target.value)} className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-gray-400">Amortisman (₺/S)</label>
                      <input type="number" value={amortization} onChange={(e) => setAmortization(e.target.value)} className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-gray-400">İşçilik (₺/S)</label>
                      <input type="number" value={hourlyLaborRate} onChange={(e) => setHourlyLaborRate(e.target.value)} className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-orange-400">Fire Payı (%)</label>
                      <input type="number" value={failureRate} onChange={(e) => setFailureRate(e.target.value)} className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm" />
                    </div>
                  </div>
                </div>
              </div>

              {/* SAĞ YAN (SONUÇLAR & SİPARİŞ OLUŞTUR) */}
              <div className="xl:col-span-4 space-y-6">
                <div className="bg-gradient-to-br from-gray-900 to-gray-950 rounded-2xl p-6 border border-gray-800 shadow-2xl relative overflow-hidden">
                  <h2 className="text-lg font-semibold mb-4 text-white">Sonuç</h2>
                  <div className="space-y-3 bg-gray-950/50 p-4 rounded-xl mb-4 border border-gray-800">
                    <div className="flex justify-between text-sm"><span className="text-gray-400">Malzeme</span><span>{materialCost.toFixed(2)} ₺</span></div>
                    <div className="flex justify-between text-sm"><span className="text-gray-400">Elektrik</span><span>{electricityCost.toFixed(2)} ₺</span></div>
                    <div className="flex justify-between text-sm"><span className="text-gray-400">Amortisman</span><span>{amortizationCost.toFixed(2)} ₺</span></div>
                    <div className="flex justify-between text-sm"><span className="text-gray-400">İşçilik</span><span>{laborCost.toFixed(2)} ₺</span></div>
                  </div>
                  <div className="flex justify-between font-medium text-gray-300 mb-2">
                    <span>Maliyet (+Fire)</span><span>{totalNetCost.toFixed(2)} ₺</span>
                  </div>
                  <div className="flex justify-between items-center bg-gray-950 border border-gray-700 p-2 rounded-lg mb-4">
                    <span className="text-green-400 text-sm">Kâr Marjı (%)</span>
                    <input type="number" value={profitMargin} onChange={(e) => setProfitMargin(e.target.value)} className="w-16 bg-transparent text-right outline-none text-white font-medium" />
                  </div>
                  <div className="bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl p-4 shadow-lg">
                    <span className="block text-blue-100 text-xs mb-1">Önerilen Satış Fiyatı</span>
                    <div className="text-3xl font-bold text-white">{salePrice.toFixed(2)} <span className="text-lg">₺</span></div>
                  </div>
                </div>

                {/* Sipariş Oluştur */}
                <div className="bg-gray-900/50 rounded-2xl p-6 border border-gray-800 shadow-xl space-y-4">
                  <h3 className="font-medium text-purple-400 flex items-center gap-2"><Plus className="w-4 h-4"/> Yeni Sipariş Oluştur</h3>
                  <input type="text" placeholder="Müşteri Adı" value={customerName} onChange={e=>setCustomerName(e.target.value)} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                  <input type="text" placeholder="Ürün Adı (Örn: Batman)" value={saveName} onChange={e=>setSaveName(e.target.value)} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                  <input type="text" placeholder="Teslim Tarihi (Örn: 25 Ağu)" value={dueDate} onChange={e=>setDueDate(e.target.value)} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                  <button onClick={handleCreateOrder} disabled={!saveName || totalNetCost<=0 || !selectedFilamentId} className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors">
                    Siparişe Çevir
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 2. STOK SEKMESİ */}
          {activeTab === 'inventory' && (
            <div className="space-y-6">
              <div className="bg-gray-900/50 rounded-2xl p-6 border border-gray-800 shadow-xl">
                <h2 className="text-lg font-semibold mb-4 text-orange-400">Yeni Filament Ekle</h2>
                <div className="flex flex-wrap gap-4 items-end">
                  <div className="space-y-1 flex-1 min-w-[120px]"><label className="text-xs text-gray-400">Marka</label><input type="text" value={newInv.brand} onChange={e=>setNewInv({...newInv, brand: e.target.value})} placeholder="Örn: Esun" className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm" /></div>
                  <div className="space-y-1 flex-1 min-w-[120px]"><label className="text-xs text-gray-400">Renk</label><input type="text" value={newInv.color} onChange={e=>setNewInv({...newInv, color: e.target.value})} placeholder="Örn: Siyah" className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm" /></div>
                  <div className="space-y-1 flex-1 min-w-[100px]"><label className="text-xs text-gray-400">Materyal</label>
                    <select value={newInv.material} onChange={e=>setNewInv({...newInv, material: e.target.value})} className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm">
                      <option>PLA</option><option>PETG</option><option>ABS</option><option>TPU</option><option>ASA</option>
                    </select>
                  </div>
                  <div className="space-y-1 w-24"><label className="text-xs text-gray-400">Gramaj</label><input type="number" value={newInv.weight} onChange={e=>setNewInv({...newInv, weight: parseFloat(e.target.value)})} className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm" /></div>
                  <div className="space-y-1 w-24"><label className="text-xs text-gray-400">Fiyat(₺/kg)</label><input type="number" value={newInv.pricePerKg} onChange={e=>setNewInv({...newInv, pricePerKg: parseFloat(e.target.value)})} className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm" /></div>
                  <button onClick={handleAddInventory} className="bg-orange-600 hover:bg-orange-500 px-6 py-2 rounded font-medium transition-colors h-[38px]">Ekle</button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {inventory.map(item => (
                  <div key={item.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col relative overflow-hidden">
                    <div className={`absolute top-0 left-0 w-1 h-full ${item.weight < 200 ? 'bg-red-500' : 'bg-green-500'}`}></div>
                    <div className="flex justify-between items-start mb-2 pl-2">
                      <div>
                        <h3 className="font-bold text-white">{item.brand}</h3>
                        <p className="text-sm text-gray-400">{item.color} - {item.material}</p>
                      </div>
                      <button onClick={() => handleDeleteInventory(item.id)} className="text-gray-600 hover:text-red-400"><Trash2 className="w-4 h-4"/></button>
                    </div>
                    <div className="mt-auto pt-4 pl-2 grid grid-cols-2 gap-2 text-sm">
                      <div><span className="block text-xs text-gray-500">Kalan</span><span className={`font-semibold ${item.weight < 200 ? 'text-red-400' : 'text-green-400'}`}>{item.weight.toFixed(1)}g</span></div>
                      <div><span className="block text-xs text-gray-500">Maliyet</span><span className="font-semibold text-gray-300">{item.pricePerKg} ₺/kg</span></div>
                    </div>
                  </div>
                ))}
                {inventory.length === 0 && <p className="text-gray-500 p-4">Stokta filament bulunmuyor.</p>}
              </div>
            </div>
          )}

          {/* 3. SİPARİŞLER SEKMESİ */}
          {activeTab === 'orders' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-purple-400">Aktif & Geçmiş Siparişler</h2>
              </div>
              
              <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-gray-900 text-gray-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Müşteri</th>
                      <th className="px-4 py-3 font-medium">Ürün</th>
                      <th className="px-4 py-3 font-medium">Tarih / Teslim</th>
                      <th className="px-4 py-3 font-medium">Fiyat</th>
                      <th className="px-4 py-3 font-medium">Durum</th>
                      <th className="px-4 py-3 font-medium text-right">İşlem</th>
                    </tr>
                  </thead>
                  <tbody className="bg-gray-950 divide-y divide-gray-800">
                    {orders.length === 0 && <tr><td colSpan="6" className="px-4 py-8 text-center text-gray-500">Kayıtlı sipariş yok.</td></tr>}
                    {orders.map(o => (
                      <tr key={o.id} className="hover:bg-gray-900/50">
                        <td className="px-4 py-3 text-white font-medium">{o.customer}</td>
                        <td className="px-4 py-3 text-gray-300">{o.product}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{o.date} <br/><span className="text-gray-500">{o.dueDate}</span></td>
                        <td className="px-4 py-3 text-green-400 font-medium">{o.salePrice.toFixed(2)} ₺</td>
                        <td className="px-4 py-3">
                          <select 
                            value={o.status} 
                            onChange={(e) => handleUpdateOrderStatus(o.id, e.target.value)}
                            className={`px-2 py-1 rounded text-xs font-medium border outline-none ${
                              o.status === 'Bekliyor' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' :
                              o.status === 'Baskıda' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                              'bg-green-500/10 text-green-400 border-green-500/20'
                            }`}
                          >
                            <option value="Bekliyor" className="bg-gray-900">Bekliyor</option>
                            <option value="Baskıda" className="bg-gray-900">Baskıda</option>
                            <option value="Tamamlandı" className="bg-gray-900">Tamamlandı</option>
                          </select>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => handleDeleteOrder(o.id)} className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-800 rounded"><Trash2 className="w-4 h-4"/></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default App;
