import { ScrollText, ShieldCheck, UserCheck, Database, AlertTriangle, MessageCircle, FileEdit, Ban } from 'lucide-react';

interface Section {
  id: string;
  title: string;
  body: React.ReactNode;
}

const sections: Section[] = [
  {
    id: 'acceptance',
    title: '1. การยอมรับข้อกำหนด',
    body: (
      <>
        <p>
          การเข้าใช้งานระบบ DOT (Department of Transportation) ของเมือง Bit Cities ถือว่าท่านได้อ่าน ทำความเข้าใจ
          และยอมรับข้อกำหนดและเงื่อนไขการใช้งาน (Terms of Service) ฉบับนี้ทั้งหมด หากท่านไม่ยอมรับข้อกำหนดใด ๆ
          กรุณาหยุดการใช้งานระบบทันที
        </p>
        <p>
          กรมขนส่งขอสงวนสิทธิ์ในการปรับปรุง เปลี่ยนแปลง หรือยกเลิกข้อกำหนดนี้ได้ตลอดเวลาโดยไม่ต้องแจ้งให้ทราบล่วงหน้า
          การใช้งานระบบหลังจากมีการเปลี่ยนแปลงถือว่าท่านยอมรับข้อกำหนดฉบับปรับปรุงแล้ว
        </p>
      </>
    ),
  },
  {
    id: 'eligibility',
    title: '2. คุณสมบัติผู้ใช้งาน',
    body: (
      <>
        <p>
          ระบบ DOT แบ่งผู้ใช้งานออกเป็น 2 ระดับ ได้แก่
        </p>
        <ul className="list-disc list-inside space-y-1.5">
          <li><strong className="text-white">ประชาชนทั่วไป</strong> — สามารถดูข้อมูลสถิติ ทำเนียบบุคลากร อัตราค่าบริการ ส่งเรื่องร้องเรียน และแจ้งเหตุฉุกเฉินได้</li>
          <li><strong className="text-white">เจ้าหน้าที่กรมขนส่ง</strong> — ต้องได้รับการแต่งตั้งจากหัวหน้ากรมขนส่ง (Commissioner) และเข้าสู่ระบบด้วยบัญชีที่ได้รับอนุญาตเท่านั้น</li>
        </ul>
        <p>
          การเข้าสู่ระบบด้วยบัญชีของผู้อื่น หรือแอบอ้างเป็นเจ้าหน้าที่โดยมิได้รับอนุญาต ถือเป็นการละเมิดข้อกำหนดอย่างร้ายแรง
        </p>
      </>
    ),
  },
  {
    id: 'data-collection',
    title: '3. การเก็บรวบรวมและใช้ข้อมูลส่วนบุคคล',
    body: (
      <>
        <p>
          กรมขนส่งเก็บรวบรวมข้อมูลที่จำเป็นต่อการให้บริการเท่านั้น เช่น Discord Username, ชื่อในเกม (In-game name)
          และข้อมูลที่ท่านระบุผ่านแบบฟอร์มร้องเรียน/แจ้งเหตุฉุกเฉิน
        </p>
        <p>
          ข้อมูลของท่านจะถูกใช้เพื่อการดำเนินงานของกรมขนส่งเท่านั้น <strong className="text-white">จะไม่มีการเปิดเผยต่อบุคคลภายนอก</strong>
          ยกเว้นเป็นไปตามคำสั่งศาลหรือหน่วยงานราชการที่มีอำนาจตามกฎหมาย
        </p>
        <p>
          ท่านสามารถขอแก้ไขหรือลบข้อมูลส่วนบุคคลได้ โดยติดต่อผ่านช่องทางร้องเรียนของระบบ
        </p>
      </>
    ),
  },
  {
    id: 'conduct',
    title: '4. กฎเกณฑ์การใช้งานและมารยาท',
    body: (
      <>
        <p>ผู้ใช้งานต้องปฏิบัติตามกฎเกณฑ์ดังต่อไปนี้:</p>
        <ul className="list-disc list-inside space-y-1.5">
          <li>ห้ามใช้ข้อความที่ไม่สุภาพ คุกคาม ดูหมิ่น หรือก่อให้เกิดความแตกแยก</li>
          <li>ห้ามส่งข้อมูลอันเป็นเท็จ หรือแจ้งเหตุฉุกเฉิน/ร้องเรียนโดยไม่สุจริต</li>
          <li>ห้ามพยายามเจาะระบบ ดัดแปลง หรือแทรกแซงการทำงานของ DOT System</li>
          <li>ห้ามเผยแพร่ข้อมูลของเจ้าหน้าที่หรือผู้อื่นโดยไม่ได้รับอนุญาต</li>
          <li>ใช้งานตามวัตถุประสงค์ของระบบเท่านั้น ไม่นำไปใช้ในเชิงพาณิชย์</li>
        </ul>
      </>
    ),
  },
  {
    id: 'service-changes',
    title: '5. การเปลี่ยนแปลงบริการ',
    body: (
      <p>
        กรมขนส่งขอสงวนสิทธิ์ในการปรับปรุง เปลี่ยนแปลง ระงับ หรือยกเลิกฟีเจอร์ใด ๆ ของระบบได้ตลอดเวลา
        โดยไม่จำเป็นต้องแจ้งให้ทราบล่วงหน้า ทั้งนี้เพื่อรักษาคุณภาพการให้บริการและความปลอดภัยโดยรวม
      </p>
    ),
  },
  {
    id: 'liability',
    title: '6. ข้อจำกัดความรับผิดชอบ',
    body: (
      <>
        <p>
          ระบบ DOT จัดทำขึ้นเพื่ออำนวยความสะดวกในการดำเนินงานของกรมขนส่งในเมือง Bit Cities (Roleplay Server)
          <strong className="text-white"> ไม่ใช่ระบบราชการจริง</strong> และไม่มีผลผูกพันทางกฎหมายใด ๆ นอกเหนือจากบริบทของเกม
        </p>
        <p>
          กรมขนส่งไม่รับผิดชอบต่อความเสียหาย ความสูญเสีย หรือผลกระทบใด ๆ ที่เกิดจากการใช้งานระบบในทางที่ผิด
          หรือการหยุดชะงักของบริการอันเกิดจากเหตุสุดวิสัย
        </p>
      </>
    ),
  },
  {
    id: 'complaints',
    title: '7. การร้องเรียนและการดำเนินการ',
    body: (
      <>
        <p>
          หากพบเห็นการละเมิดข้อกำหนด หรือต้องการรายงานปัญหาเกี่ยวกับการให้บริการ สามารถแจ้งผ่านช่องทาง
          "ร้องเรียน" ในระบบ หรือติดต่อหัวหน้ากรมขนส่งโดยตรง
        </p>
        <p>
          กรมขนส่งจะพิจารณาเรื่องร้องเรียนอย่างเป็นธรรมและโปร่งใส โดยอาศัยหลักฐานที่เกี่ยวข้องประกอบการตัดสิน
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    title: '8. การปรับปรุงข้อกำหนด',
    body: (
      <p>
        ข้อกำหนดฉบับนี้อาจมีการปรับปรุงเป็นครั้งคราว ท่านสามารถตรวจสอบฉบับล่าสุดได้ที่หน้านี้เสมอ
        วันที่มีผลบังคับใช้จะระบุไว้ด้านล่างของเอกสาร
      </p>
    ),
  },
];

const highlights = [
  { icon: ShieldCheck, label: 'ความปลอดภัยข้อมูล' },
  { icon: UserCheck, label: 'สิทธิ์การเข้าถึง' },
  { icon: Database, label: 'การจัดการข้อมูล' },
  { icon: MessageCircle, label: 'ช่องทางร้องเรียน' },
];

export function TermsPage() {
  return (
    <div className="bg-navy-900 min-h-[calc(100dvh-4rem)]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-8">
        {/* Header */}
        <header className="rounded-2xl border border-blue-900/40 bg-gradient-to-br from-navy-800/80 to-navy-900 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center flex-shrink-0">
              <ScrollText size={28} className="text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-amber-500 font-semibold tracking-widest mb-1">DEPARTMENT OF TRANSPORTATION</p>
              <h1 className="text-2xl sm:text-3xl font-black text-white mb-1">ข้อกำหนดและเงื่อนไขการใช้งาน</h1>
              <p className="text-sm text-gray-400">Terms of Service · DOT System</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            {highlights.map((h) => (
              <div key={h.label} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-navy-900/60 border border-blue-900/40">
                <h.icon size={16} className="text-amber-400 flex-shrink-0" />
                <span className="text-xs text-gray-300">{h.label}</span>
              </div>
            ))}
          </div>
        </header>

        {/* Notice banner */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm">
          <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
          <p>
            การเข้าใช้งานระบบ DOT ถือว่าท่านได้ยอมรับข้อกำหนดฉบับนี้ทั้งหมด กรุณาอ่านอย่างละเอียดก่อนใช้งาน
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-6">
          {sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              className="rounded-xl border border-blue-900/40 bg-navy-800/60 p-5 sm:p-6"
            >
              <h2 className="text-lg sm:text-xl font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-amber-400">•</span>
                {section.title}
              </h2>
              <div className="space-y-3 text-sm sm:text-base text-gray-300 leading-relaxed">
                {section.body}
              </div>
            </section>
          ))}
        </div>

        {/* Footer */}
        <footer className="rounded-xl border border-blue-900/40 bg-navy-800/60 p-5 sm:p-6 text-center">
          <FileEdit size={20} className="text-amber-400 mx-auto mb-2" />
          <p className="text-sm text-gray-400">
            ข้อกำหนดนี้มีผลบังคับใช้ตั้งแต่วันที่ประกาศ
          </p>
          <p className="text-xs text-gray-500 mt-2">
            © {new Date().getFullYear()} Bit Cities · Department of Transportation
          </p>
        </footer>

        {/* Prohibited use callout */}
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5">
          <div className="flex items-start gap-3">
            <Ban size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-red-300 mb-1">การละเมิดข้อกำหนด</h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                การละเมิดข้อกำหนดการใช้งานอาจส่งผลให้ถูกระงับสิทธิ์การใช้งาน ถูกลงโทษทางวินัย
                หรือถูกดำเนินการตามกฎระเบียบของเมือง Bit Cities
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}