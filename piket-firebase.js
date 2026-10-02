/*
 * SMKWD PIKET — DIRECT FIREBASE ADAPTER
 * Final audited build for index-piket-firebase-final.html
 *
 * IMPORTANT:
 * - Does not overwrite existing Absensi Siswa/Guru records.
 * - Uses update() for completion so existing fields are preserved.
 * - Current attendance uses narrow date-key queries and realtime listeners.
 * - Historical data is loaded only when Laporan Harian requests a date.
 * - Firebase Authentication password is NEVER stored in Realtime Database.
 */
(function(){
'use strict';

const SDK='12.8.0';
const RAW_CFG=window.SMKWDFirebaseConfig||{};
const CFG=RAW_CFG.firebase ? Object.assign({},RAW_CFG.firebase) : Object.assign({},RAW_CFG);
const SCHOOL=String(RAW_CFG.schoolId||CFG.schoolId||'SMKWD');
const TZ='Asia/Jakarta';
const SESSION='guruPiketFirebaseSession';

let fbReady;
const ready=(async()=>{
  const [appMod,dbMod,authMod]=await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-database.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`)
  ]);
  const {initializeApp,getApps,getApp}=appMod;
  const {getDatabase,ref,get,set,update,remove,push,query,orderByKey,startAt,endAt,orderByChild,equalTo,onValue,get:getValue,runTransaction}=dbMod;
  const {getAuth,onAuthStateChanged,signInWithEmailAndPassword,signOut,setPersistence,browserLocalPersistence}=authMod;
  const app=getApps().length?getApp():initializeApp(CFG);
  const db=getDatabase(app);
  const auth=getAuth(app);
  await setPersistence(auth,browserLocalPersistence);
  const authReady=new Promise(resolve=>{
    if(auth.currentUser) return resolve(auth.currentUser);
    const off=onAuthStateChanged(auth,u=>{off();resolve(u);});
  });
  return {app,db,auth,ref,get,set,update,remove,push,query,orderByKey,startAt,endAt,orderByChild,equalTo,onValue,getValue,runTransaction,onAuthStateChanged,signInWithEmailAndPassword,signOut,authReady};
})();
fbReady=ready;

const rootPath=p=>'schools/'+SCHOOL+'/'+String(p||'').replace(/^\/+/, '');
const r=(fb,p)=>fb.ref(rootPath(p));
const key=v=>String(v??'').trim().replace(/[.#$\/\[\]]/g,'_')||'_';
const pad=n=>String(n).padStart(2,'0');
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const nowTime=()=>new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());
const normTime=v=>{const m=String(v||'').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);return m?pad(m[1])+':'+m[2]+':'+(m[3]||'00'):String(v||'')};
const valuesFrom=v=>v&&typeof v==='object'?(Array.isArray(v)?v:Object.values(v)):[];

async function profile(){
  const fb=await fbReady;
  const u=await fb.authReady;
  if(!u) throw new Error('Belum login Firebase.');
  const s=await fb.getValue(r(fb,'security/users/'+key(u.uid)));
  const p=s.val();
  if(!p || p.active!==true) throw new Error('Profil Firebase belum dibuat atau akun tidak aktif.');
  p.uid=u.uid;
  return p;
}

async function roleOK(roles){
  const p=await profile();
  const allowed=(Array.isArray(roles)?roles:[roles]).map(x=>String(x).toLowerCase());
  const role=String(p.role||'').toLowerCase();
  if(!allowed.includes(role)) throw new Error('Anda tidak memiliki hak akses untuk operasi ini.');
  return p;
}

async function read(path){
  const fb=await fbReady;
  const s=await fb.getValue(r(fb,path));
  return s.val()||{};
}

async function values(path){
  const x=await read(path);
  return Object.entries(x).map(([id,v])=>Object.assign({_id:id},v||{}));
}

/* Piket records use push IDs, so date filtering must be done with orderByChild.
 * Add .indexOn:["tanggal"] under these Piket nodes in Rules for best performance. */
async function dateRows(path,date){
  const fb=await fbReady;
  const q=fb.query(r(fb,path),fb.orderByChild('tanggal'),fb.equalTo(String(date)));
  const s=await fb.getValue(q);
  return Object.entries(s.val()||{}).map(([id,v])=>Object.assign({_id:id},v||{}));
}

function attendanceQuery(path,date){
  return fbReady.then(fb=>{
    const q=fb.query(r(fb,path),fb.orderByKey(),fb.startAt(String(date)+'_'),fb.endAt(String(date)+'_\uf8ff'));
    return fb.getValue(q).then(s=>s.val()||{});
  });
}

function onAttendance(path,date,cb){
  let stop=null;
  fbReady.then(fb=>{
    const q=fb.query(r(fb,path),fb.orderByKey(),fb.startAt(String(date)+'_'),fb.endAt(String(date)+'_\uf8ff'));
    stop=fb.onValue(q,s=>cb(s.val()||{}),err=>console.error('Realtime Firebase:',err));
  }).catch(err=>console.error('Realtime init:',err));
  return ()=>{if(stop)stop();};
}

function normalizePiketEmail(username){
  return String(username||'').trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9._-]/g,'')+'@piket.smkwd.local';
}

function hariIndonesia(){
  return new Intl.DateTimeFormat('id-ID',{timeZone:TZ,weekday:'long'}).format(new Date());
}

async function hasPiketScheduleToday(pr){
  const rows=await values('apps/piket/jadwal');
  const uid=String(pr.userID||pr.UserID||'').trim();
  const hari=hariIndonesia().toLowerCase();
  return rows.some(x=>{
    if(String(x.Status||x.status||'Aktif').toLowerCase()!=='aktif') return false;
    if(String(x.UserID||x.userID||'').trim()!==uid) return false;
    const rowHari=String(x.Hari||x.hari||'').trim().toLowerCase();
    if(rowHari) return rowHari===hari;
    const rowTanggal=String(x.Tanggal||x.tanggal||'').slice(0,10);
    return rowTanggal===today();
  });
}

async function login(username,password){
  const fb=await fbReady;
  const u=String(username||'').trim();
  const p=String(password||'');
  if(!u||!p)return {ok:false,message:'Username dan password wajib diisi.'};

  // Petugas Piket hasil provisioning memakai satu email deterministik.
  // Akun Guru/Admin yang sudah ada tetap dicoba melalui mekanisme lama.
  const emailCandidates=u.includes('@')?[u]:[
    normalizePiketEmail(u),
    u.toLowerCase().replace(/\s+/g,'_')+'@petugas.smkwd.local',
    u.toLowerCase().replace(/\s+/g,'_')+'@guru.smkwd.local',
    u.toLowerCase().replace(/\s+/g,'_')+'@admin.smkwd.local'
  ];
  let last=null;
  for(const email of [...new Set(emailCandidates)]){
    try{
      const c=await fb.signInWithEmailAndPassword(fb.auth,email,p);
      const pr=await profile();
      const role=String(pr.role||'').toLowerCase();
      if(role==='petugas'){
        const allowed=await hasPiketScheduleToday(pr);
        if(!allowed){
          await fb.signOut(fb.auth);
          return {ok:false,message:'Anda tidak memiliki jadwal piket hari ini.'};
        }
      }
      return {ok:true,token:c.user.uid,user:{Username:pr.username||pr.identifier||u,NamaPetugas:pr.nama||u,Role:pr.role||'',Aktif:pr.active===true,uid:c.user.uid,UserID:pr.userID||pr.UserID||''}};
    }catch(e){last=e;try{await fb.signOut(fb.auth);}catch(_){} }
  }
  return {ok:false,message:last?.code==='auth/invalid-credential'?'Username atau password salah.':(last?.message||'Login gagal.')};
}

async function logout(){
  const fb=await fbReady;
  await fb.signOut(fb.auth);
  localStorage.removeItem(SESSION);
  return {ok:true};
}

async function initial(){
  const [guru,jadwal,kejadian,siswaTerlambat,tugas,users]=await Promise.all([
    values('shared/teachers'),
    dateRows('apps/piket/jadwal',today()),
    dateRows('apps/piket/kejadian',today()),
    dateRows('apps/piket/siswaTerlambat',today()),
    dateRows('apps/piket/tugas',today()),
    values('apps/piket/users')
  ]);
  return {
    guru:guru.map(x=>({GuruID:x.idGuru||x.GuruID||x._id,NamaGuru:x.nama||x.NamaGuru,Mapel:x.mataPelajaran||x.Mapel||'',NoHP:x.noHP||x.NoHP||'',Aktif:x.aktif===false?'Tidak':'Ya'})),
    jadwal,jadwalCount:jadwal.length,kejadian,siswaTerlambat,tugas,users
  };
}

async function dash(){
  const d=await initial();
  const date=today();
  const [ss,gg]=await Promise.all([
    attendanceQuery('apps/absensi_siswa/attendance',date),
    attendanceQuery('apps/absensi_guru/attendance',date)
  ]);
  return {
    guru:d.guru.filter(x=>x.Aktif==='Ya').length,
    jadwal:d.jadwal.length,
    hadir:Object.keys(gg||{}).length,
    kejadian:d.kejadian.filter(x=>String(x.status||x.Status||'').toLowerCase()!=='selesai').length,
    tugas:d.tugas.filter(x=>String(x.status||x.Status||'').toLowerCase()!=='selesai').length,
    siswa:Object.keys(ss||{}).length
  };
}

async function patchPiket(path,data){const fb=await fbReady;await fb.update(r(fb,path),data);return data;}
async function pushPiket(path,data){const fb=await fbReady;const p=fb.push(r(fb,path));await fb.set(p,data);return p.key;}

async function hadir(token,guruId,shift,keterangan,pulang){
  const p=await roleOK(['admin','guru','petugas']);
  const date=today();
  const id=String(guruId||'').trim();
  if(!id) throw new Error('Guru wajib dipilih.');
  const guru=(await values('shared/teachers')).find(x=>String(x.idGuru||x.GuruID||x._id)===id);
  if(!guru)throw new Error('Guru tidak ditemukan.');
  const path='apps/absensi_guru/attendance/'+key(date+'_'+id);
  const fb=await fbReady;
  const snap=await fb.getValue(r(fb,path));
  const old=snap.val()||{};
  if(pulang){
    if(!old.jamMasuk)throw new Error('Guru belum memiliki data absen masuk.');
    if(old.jamPulang)throw new Error('Guru sudah tercatat absen pulang pada '+old.jamPulang+'.');
    await fb.update(r(fb,path),{jamPulang:nowTime(),status:old.status||'Hadir',keterangan:keterangan||old.keterangan||''});
    return {ok:true,message:'Absen pulang berhasil dan tersimpan di Absensi Guru.'};
  }
  if(old.jamMasuk)throw new Error('Guru sudah melakukan absen datang pada '+old.jamMasuk+'.');
  const patch={
    tanggal:old.tanggal||date,idGuru:old.idGuru||id,nama:old.nama||guru.nama||guru.NamaGuru||'',
    jabatan:old.jabatan||guru.jabatan||'Guru',kelas:old.kelas||guru.kelas||'',mataPelajaran:old.mataPelajaran||guru.mataPelajaran||guru.Mapel||'',
    shift:old.shift||shift||'',kunciAbsensi:old.kunciAbsensi||'',jamMasuk:nowTime(),status:old.status||'Hadir',keterangan:keterangan||old.keterangan||''
  };
  await fb.update(r(fb,path),patch);
  return {ok:true,message:'Absen datang berhasil dan tersimpan di Absensi Guru.'};
}

async function absensiPetugas(token,pulang,ket){
  const p=await roleOK(['admin','guru','petugas']);
  const date=today();
  const fb=await fbReady;
  const uid=fb.auth.currentUser?.uid;
  if(!uid)throw new Error('Sesi Firebase tidak tersedia.');
  const path='apps/piket/absensiPetugas/'+key(date+'_'+uid);
  const s=await fb.getValue(r(fb,path));
  const old=s.val()||{};
  if(pulang && !old.JamDatang)throw new Error('Absensi datang petugas belum tercatat.');
  if(pulang && old.JamPulang)throw new Error('Absensi pulang petugas sudah tercatat pada '+old.JamPulang+'.');
  const patch={Tanggal:old.Tanggal||date,UID:old.UID||uid,NamaPetugas:old.NamaPetugas||p.nama||'',Keterangan:ket||old.Keterangan||'',Status:'Hadir'};
  if(pulang)patch.JamPulang=nowTime(); else if(!old.JamDatang)patch.JamDatang=nowTime();
  await patchPiket(path,patch);
  return {ok:true,message:pulang?'Absensi pulang petugas berhasil.':'Absensi datang petugas berhasil.'};
}

async function getPiketStudentView(tanggal){
  await roleOK(['admin','guru','petugas']);
  const [students,data]=await Promise.all([values('shared/students'),attendanceQuery('apps/absensi_siswa/attendance',tanggal)]);
  const by={};
  Object.values(data||{}).forEach(x=>{by[String(x.nisn||'')]=x;});
  return students
    .filter(s=>s.active===undefined||s.active===null||s.active===true||!['false','0','tidak aktif','nonaktif','inactive'].includes(String(s.active).toLowerCase()))
    .map(s=>{
      const nisn=String(s.nisn||s.NISN||s.identifier||s._id||'');
      const x=by[nisn]||{};
      return {Tanggal:tanggal,NISN:nisn,Nama:x.nama||s.nama||s.Nama||'',Kelas:x.kelas||s.kelas||s.Kelas||'',JamDatang:normTime(x.jamDatang),JamPulang:normTime(x.jamPulang),KeteranganWaktu:x.keterangan||'',Status:x.status||'Belum Absen'};
    })
    .filter(x=>x.NISN);
}

async function absensiSiswa(tanggal,kelas,status,q){
  const a=await getPiketStudentView(tanggal);
  const qq=String(q||'').toLowerCase();
  return a.filter(x=>(!kelas||x.Kelas===kelas)&&(!status||x.Status===status)&&(!qq||JSON.stringify(x).toLowerCase().includes(qq)));
}

async function kelasAbsensiSiswa(token,tanggal){
  const a=await getPiketStudentView(tanggal);
  return [...new Set(a.map(x=>x.Kelas).filter(Boolean))].sort();
}

/* Complete one student record without replacing an existing record. */
async function lengkapiAbsensiSiswa(token,nisn,status,jamDatang,jamPulang,keterangan){
  await roleOK(['admin','guru','petugas']);
  const date=today();
  const id=String(nisn||'').trim();
  if(!id)throw new Error('NISN wajib diisi.');
  const student=(await values('shared/students')).find(x=>String(x.nisn||x.NISN||x.identifier||x._id)===id);
  if(!student)throw new Error('Siswa tidak ditemukan.');
  const path='apps/absensi_siswa/attendance/'+key(date+'_'+id);
  const fb=await fbReady;
  const s=await fb.getValue(r(fb,path));
  const old=s.val()||{};
  const st=String(status||'Hadir');
  if(old.jamDatang && st==='Hadir' && !jamPulang)throw new Error('Siswa sudah memiliki jam datang '+old.jamDatang+'.');
  const patch={
    tanggal:old.tanggal||date,
    nisn:old.nisn||id,
    nama:old.nama||student.nama||student.Nama||'',
    kelas:old.kelas||student.kelas||student.Kelas||'',
    status:st,
    keterangan:keterangan!==undefined?keterangan:(old.keterangan||'')
  };
  if(st==='Hadir'){
    if(!old.jamDatang)patch.jamDatang=jamDatang||nowTime();
    if(jamPulang)patch.jamPulang=jamPulang;
  }else{
    if(jamDatang)patch.jamDatang=jamDatang;
    if(jamPulang)patch.jamPulang=jamPulang;
  }
  await fb.update(r(fb,path),patch);
  return {ok:true,message:'Absensi siswa berhasil dilengkapi dan tersimpan di Absensi Siswa.'};
}

async function simpanAbsensiSiswa(token,tanggal,kelas,status,q){
  return {ok:true,message:'Data absensi sudah terhubung langsung ke Firebase. Gunakan tombol Lengkapi pada siswa yang belum absen.'};
}

async function absensiGuru(token,tanggal){
  await roleOK(['admin','guru','petugas']);
  const data=await attendanceQuery('apps/absensi_guru/attendance',tanggal);
  return Object.values(data).map(x=>({Tanggal:x.tanggal||tanggal,NIP:x.idGuru||'',Nama:x.nama||'',Shift:x.shift||'',JamDatang:normTime(x.jamMasuk),JamPulang:normTime(x.jamPulang),Status:x.status||'Hadir',Keterangan:x.keterangan||''}));
}
async function simpanAbsensiGuru(token,tanggal){return {ok:true,message:'Absensi guru sudah terhubung langsung ke Firebase. Gunakan menu Kehadiran untuk melengkapi guru yang belum absen.'};}

async function jadwal(token,data){
  await roleOK(['admin','guru']);
  const x=Object.assign({},data,{tanggal:data.Tanggal||today()});
  return {ok:true,id:await pushPiket('apps/piket/jadwal',x),message:'Jadwal tersimpan.'};
}
async function kejadian(token,data){
  await roleOK(['admin','guru','petugas']);
  if(data.Jenis==='Siswa Terlambat')throw new Error('Siswa terlambat harus dimasukkan melalui menu Siswa Terlambat.');
  return {ok:true,id:await pushPiket('apps/piket/kejadian',Object.assign({},data,{tanggal:data.Tanggal||today()})),message:'Kejadian tersimpan.'};
}
async function siswaTerlambat(token,data){
  const p=await roleOK(['admin','guru','petugas']);
  return {ok:true,id:await pushPiket('apps/piket/siswaTerlambat',Object.assign({},data,{tanggal:data.Tanggal||today(),DicatatOleh:p.nama||''})),message:'Data siswa terlambat berhasil disimpan.'};
}
async function tugas(token,data){
  await roleOK(['admin','guru','petugas']);
  return {ok:true,id:await pushPiket('apps/piket/tugas',Object.assign({},data,{tanggal:data.Tanggal||today()})),message:'Tugas tersimpan.'};
}
async function user(token,data){
  await roleOK('admin');
  const x={Username:data.Username||'',NamaPetugas:data.NamaPetugas||'',Role:data.Role||'Petugas',Aktif:'Ya'};
  return {ok:true,id:await pushPiket('apps/piket/users',x),message:'Profil pengguna Piket tersimpan. Akun Firebase Authentication harus sudah/proses diprovision secara terpisah.'};
}
async function guru(token,data){
  await roleOK('admin');
  const id=key(data.NIP);
  const fb=await fbReady;
  const path='shared/teachers/'+id;
  const old=(await fb.getValue(r(fb,path))).val()||{};
  const patch=Object.assign({},old,{idGuru:data.NIP,nama:data.NamaGuru,mataPelajaran:data.Mapel||'',noHP:data.NoHP||'',email:data.Email||'',aktif:data.Aktif!=='Tidak'});
  await fb.update(r(fb,path),patch);
  return {ok:true,message:'Data guru tersimpan tanpa menghapus field guru yang sudah ada.'};
}

async function laporanHarian(token,tanggal){
  await roleOK(['admin','guru','petugas']);
  const [s,g,k,st,t,p]=await Promise.all([
    absensiSiswa(tanggal,'','',''),
    absensiGuru(token,tanggal),
    dateRows('apps/piket/kejadian',tanggal),
    dateRows('apps/piket/siswaTerlambat',tanggal),
    dateRows('apps/piket/tugas',tanggal),
    dateRows('apps/piket/absensiPetugas',tanggal)
  ]);
  const classes={};
  s.forEach(x=>{
    const c=x.Kelas||'-';
    classes[c]??={kelas:c,hadir:0,terlambat:0,sakit:0,izin:0,alpa:0,belum:0,total:0};
    const st=String(x.Status||'').toLowerCase();
    classes[c].total++;
    if(st==='hadir'){classes[c].hadir++;if(String(x.KeteranganWaktu||'').toLowerCase().includes('terlambat'))classes[c].terlambat++;}
    else if(st==='terlambat'){classes[c].terlambat++;}
    else if(st==='sakit')classes[c].sakit++;
    else if(st==='izin')classes[c].izin++;
    else if(st==='alpa')classes[c].alpa++;
    else if(st==='belum absen')classes[c].belum++;
  });
  const total={
    hadir:s.filter(x=>x.Status==='Hadir').length,
    terlambat:s.filter(x=>String(x.Status).toLowerCase()==='terlambat'||String(x.KeteranganWaktu).toLowerCase().includes('terlambat')).length,
    sakit:s.filter(x=>x.Status==='Sakit').length,
    izin:s.filter(x=>x.Status==='Izin').length,
    alpa:s.filter(x=>x.Status==='Alpa').length,
    belum:s.filter(x=>String(x.Status).toLowerCase()==='belum absen').length
  };
  return {ok:true,tanggal,kehadiranSiswa:{total,perKelas:Object.values(classes)},kehadiranGuru:{jumlahHadir:g.filter(x=>String(x.Status).toLowerCase()==='hadir').length,jumlahSakit:g.filter(x=>String(x.Status).toLowerCase()==='sakit').length,jumlahIzin:g.filter(x=>String(x.Status).toLowerCase()==='izin').length,jumlahAlpa:g.filter(x=>String(x.Status).toLowerCase()==='alpa').length,daftarHadir:g},kejadian:k,siswaTerlambat:st,tugasGuruTidakHadir:t,petugasPiket:{data:p,tandaTangan:p}};
}

const methods={login,logout,initial,dash,hadir,absensiPetugas,absensiSiswa,kelasAbsensiSiswa,lengkapiAbsensiSiswa,simpanAbsensiSiswa,absensiGuru,simpanAbsensiGuru,jadwal,kejadian,siswaTerlambat,tugas,user,guru,laporanHarian};

window.PiketFirebase={
  ready,
  methods,
  today,
  nowTime,
  subscribeAbsensiSiswa:(date,cb)=>onAttendance('apps/absensi_siswa/attendance',date,cb),
  subscribeAbsensiGuru:(date,cb)=>onAttendance('apps/absensi_guru/attendance',date,cb)
};

/* Backward-compatible bridge for any legacy page code that still calls google.script.run. */
window.google=window.google||{};
window.google.script=window.google.script||{};
window.google.script.run=new Proxy({}, {
  get(_t,prop){
    if(prop==='withSuccessHandler')return fn=>runner(fn,null);
    if(prop==='withFailureHandler')return fn=>runner(null,fn);
    return (...args)=>invoke(prop,args);
  }
});
function runner(success,failure){
  return new Proxy({}, {get(_t,prop){
    if(prop==='withSuccessHandler')return fn=>runner(fn,failure);
    if(prop==='withFailureHandler')return fn=>runner(success,fn);
    return (...args)=>invoke(prop,args).then(x=>{success?.(x);return x}).catch(e=>{failure?.(e);throw e});
  }});
}
async function invoke(name,args){
  await ready;
  const fn=methods[name];
  if(!fn)throw new Error('Fungsi Firebase Piket belum diimplementasikan: '+name);
  return fn(...args);
}

})();
