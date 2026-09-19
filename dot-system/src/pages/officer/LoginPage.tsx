import React, { useEffect, useState } from 'react';
import { Truck, LogIn, Eye, EyeOff, AlertCircle, Lock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { hashPassword } from '../../lib/crypto';
import { Officer } from '../../lib/types';

interface Props {
  onLogin: (officer: Officer) => void;
  onBack: () => void;
}

export function LoginPage({ onLogin, onBack }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loginEnabled, setLoginEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    supabase
      .from('system_settings')
      .select('login_enabled')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }: { data: Record<string, unknown> | null }) => {
        setLoginEnabled(data ? Boolean(data.login_enabled) : true);
      });
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError('');

    const hash = await hashPassword(password);

    const { data, error: err } = await supabase
      .from('officers')
      .select('*')
      .eq('username', username.trim())
      .maybeSingle();

    if (err || !data) {
      setError('ไม่พบบัญชีผู้ใช้นี้ในระบบ');
      setLoading(false);
      return;
    }

    if (data.status === 'deleted' || data.status === 'suspended') {
      setError('บัญชีนี้ถูกระงับหรือลบออกจากระบบ กรุณาติดต่อหัวหน้ากรม');
      setLoading(false);
      return;
    }

    if (data.password_hash !== hash) {
      setError('รหัสผ่านไม่ถูกต้อง');
      setLoading(false);
      return;
    }

    onLogin(data as Officer);
    setLoading(false);
  }
  if (loginEnabled === false) {
    return (
      <div className="min-h-screen bg-navy-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex w-16 h-16 bg-red-500/10 border-2 border-red-500/30 rounded-2xl items-center justify-center mb-4">
              <Lock size={30} className="text-red-400" />
            </div>
            <div className="text-xs text-amber-500 font-semibold tracking-widest mb-1">BIT CITIES</div>
            <h1 className="text-2xl font-black text-white">DOT System</h1>
          </div>
          <div className="card p-8 text-center">
            <h2 className="text-lg font-semibold text-white mb-3">ระบบเข้าสู่ระบบถูกปิดชั่วคราว</h2>
            <p className="text-gray-400 text-sm mb-6">
              ขณะนี้ระบบเข้าสู่ระบบสำหรับเจ้าหน้าที่ถูกปิดโดยหัวหน้ากรมขนส่ง
              อาจเป็นช่วงปิดกะหรือปรับปรุงระบบ กรุณากลับมาใหม่ภายหลัง
            </p>
            <button onClick={onBack} className="btn-secondary w-full py-3">กลับหน้าแรก</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex w-16 h-16 bg-amber-500/10 border-2 border-amber-500/30 rounded-2xl items-center justify-center mb-4">
            <Truck size={30} className="text-amber-400" />
          </div>
          <div className="text-xs text-amber-500 font-semibold tracking-widest mb-1">BIT CITIES</div>
          <h1 className="text-2xl font-black text-white">DOT System</h1>
          <p className="text-gray-500 text-sm mt-1">ระบบสำหรับเจ้าหน้าที่เท่านั้น</p>
        </div>

        {/* Login Card */}
        <div className="card p-8">
          <h2 className="text-lg font-semibold text-white mb-6">เข้าสู่ระบบ</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">ชื่อผู้ใช้งาน</label>
              <input
                className="input-field"
                placeholder="กรอก Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">รหัสผ่าน</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  className="input-field pr-10"
                  placeholder="กรอกรหัสผ่าน"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 text-red-400 text-sm">
                <AlertCircle size={14} className="flex-shrink-0" />
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full py-3 mt-2 flex items-center justify-center gap-2">
              <LogIn size={16} />
              {loading ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-blue-900/40">
            <div className="bg-navy-700/50 rounded-lg p-3 text-xs text-gray-500 space-y-1">
              <div className="text-gray-400 font-medium mb-1">คู่มือการใช้งาน</div>
              <div>• ใช้บัญชีที่ได้รับจากหัวหน้ากรมขนส่ง</div>
              <div>• ระบบนี้สงวนสิทธิ์สำหรับเจ้าหน้าที่ DOT เท่านั้น</div>
              <div>• ประชาชนสามารถตรวจสอบผ่านเมนู "ระบบประชาชน"</div>
            </div>
          </div>
        </div>

        <button onClick={onBack} className="mt-4 w-full text-center text-sm text-gray-500 hover:text-gray-300 transition-colors py-2">
          ← กลับหน้าแรก
        </button>
      </div>
    </div>
  );
}
