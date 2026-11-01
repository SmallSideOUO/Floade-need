using System;
using System.IO;
using System.Net;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using IDataObject = System.Runtime.InteropServices.ComTypes.IDataObject;
using STATSTG = System.Runtime.InteropServices.ComTypes.STATSTG;

internal static class Native {
    [DllImport("ole32.dll")] internal static extern int OleInitialize(IntPtr reserved);
    [DllImport("ole32.dll")] internal static extern void OleUninitialize();
    [DllImport("ole32.dll", EntryPoint="DoDragDrop")] private static extern int OleDragDrop(IntPtr data, IntPtr source, uint allowed, out uint effect);
    internal static int DoDragDrop(IDataObject data,IDropSource source,uint allowed,out uint effect) {
        IntPtr dataPointer=Marshal.GetComInterfaceForObject(data,typeof(IDataObject));
        IntPtr sourcePointer=Marshal.GetComInterfaceForObject(source,typeof(IDropSource));
        try { return OleDragDrop(dataPointer,sourcePointer,allowed,out effect); }
        finally { Marshal.Release(sourcePointer);Marshal.Release(dataPointer);GC.KeepAlive(data);GC.KeepAlive(source); }
    }
    [DllImport("ole32.dll")] internal static extern void ReleaseStgMedium(ref STGMEDIUM medium);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] internal static extern uint RegisterClipboardFormat(string name);
    [DllImport("kernel32.dll")] internal static extern IntPtr GlobalAlloc(uint flags, UIntPtr size);
    [DllImport("kernel32.dll")] internal static extern IntPtr GlobalLock(IntPtr handle);
    [DllImport("kernel32.dll")] internal static extern bool GlobalUnlock(IntPtr handle);
    [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int key);
    internal static short Format(string name) { return unchecked((short)RegisterClipboardFormat(name)); }
    internal static IntPtr Memory(byte[] bytes) {
        IntPtr handle=GlobalAlloc(0x42, (UIntPtr)bytes.Length);
        if(handle==IntPtr.Zero) throw new OutOfMemoryException();
        IntPtr pointer=GlobalLock(handle);
        if(pointer==IntPtr.Zero) throw new OutOfMemoryException();
        Marshal.Copy(bytes,0,pointer,bytes.Length); GlobalUnlock(handle); return handle;
    }
}

[ComVisible(true), Guid("00000121-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDropSource {
    [PreserveSig] int QueryContinueDrag([MarshalAs(UnmanagedType.Bool)] bool escape, uint keys);
    [PreserveSig] int GiveFeedback(uint effect);
}
[ComVisible(true), ClassInterface(ClassInterfaceType.None), ComDefaultInterface(typeof(IDropSource))]
public sealed class DropSource : IDropSource {
    private uint lastKeys=uint.MaxValue;
    public int QueryContinueDrag(bool escape,uint keys) { if(keys!=lastKeys){if(Bridge.Trace!=null)Bridge.Trace("drag keys="+keys);lastKeys=keys;}return escape ? 0x40101 : (keys & 1)==0 ? 0x40100 : 0; }
    public int GiveFeedback(uint effect) { return 0x40102; }
}

[ComVisible(true), Guid("3D8B0590-F691-11d2-8EA9-006097DF5BD4"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDataObjectAsyncCapability {
    void SetAsyncMode([MarshalAs(UnmanagedType.Bool)] bool value);
    void GetAsyncMode([MarshalAs(UnmanagedType.Bool)] out bool value);
    void StartOperation(IBindCtx context);
    void InOperation([MarshalAs(UnmanagedType.Bool)] out bool value);
    void EndOperation(int result, IBindCtx context, uint effects);
}

internal sealed class Entry {
    internal string Name;
    internal long Size;
    internal bool Directory;
}
internal static class Bridge {
    internal static Action<string> Trace;
    internal static string Url;
    internal static byte[] Read(string route) {
        var request=(HttpWebRequest)WebRequest.Create(Url+route);
        request.Proxy=null;
        request.Headers.Add("x-floade-transfer","1");
        request.Timeout=600000;
        request.ReadWriteTimeout=600000;
        request.AllowAutoRedirect=false;
        using(var response=request.GetResponse())
        using(var input=response.GetResponseStream())
        using(var output=new MemoryStream()) { input.CopyTo(output); return output.ToArray(); }
    }
    internal static void Done(bool success) {
        try { Read("/done?success="+(success?"true":"false")); } catch { }
    }
}

[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public sealed class RemoteStream : IStream {
    private readonly int index;
    private readonly long length;
    private long position;
    internal RemoteStream(int index,long length) { this.index=index;this.length=length; }
    public void Read(byte[] buffer,int count,IntPtr read) {
        if(position==0&&Bridge.Trace!=null)Bridge.Trace("stream read "+index);
        int available=(int)Math.Min((long)count,length-position);
        byte[] bytes=Bridge.Read("/file/"+index+"?offset="+position+"&count="+Math.Min(available,1048576));
        Array.Copy(bytes,buffer,bytes.Length);position+=bytes.Length;
        if(read!=IntPtr.Zero) Marshal.WriteInt32(read,bytes.Length);
    }
    public void Seek(long offset,int origin,IntPtr next) {
        long value=origin==0?offset:origin==1?position+offset:length+offset;
        if(value<0||value>length) throw new COMException("Invalid stream position",unchecked((int)0x80030001));
        position=value;if(next!=IntPtr.Zero) Marshal.WriteInt64(next,position);
    }
    public void Stat(out STATSTG stat,int flag) { stat=new STATSTG();stat.type=2;stat.cbSize=length;stat.grfMode=0; }
    public void Clone(out IStream stream) { var clone=new RemoteStream(index,length);clone.position=position;stream=clone; }
    public void CopyTo(IStream target,long count,IntPtr read,IntPtr written) {
        long total=0;var buffer=new byte[65536];IntPtr amount=Marshal.AllocHGlobal(4);
        try { while(total<count && position<length) { Read(buffer,(int)Math.Min(buffer.Length,count-total),amount);int n=Marshal.ReadInt32(amount);if(n==0)break;target.Write(buffer,n,IntPtr.Zero);total+=n; } }
        finally { Marshal.FreeHGlobal(amount); }
        if(read!=IntPtr.Zero)Marshal.WriteInt64(read,total);if(written!=IntPtr.Zero)Marshal.WriteInt64(written,total);
    }
    public void Write(byte[] buffer,int count,IntPtr written) { throw new COMException("Read only",unchecked((int)0x80030005)); }
    public void SetSize(long size) { throw new NotSupportedException(); }
    public void Commit(int flags) { }
    public void Revert() { throw new NotSupportedException(); }
    public void LockRegion(long offset,long count,int type) { throw new NotSupportedException(); }
    public void UnlockRegion(long offset,long count,int type) { throw new NotSupportedException(); }
}

[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public sealed class FormatEnumerator : IEnumFORMATETC {
    private readonly FORMATETC[] formats;private int position;
    internal FormatEnumerator(FORMATETC[] formats) { this.formats=formats; }
    public int Next(int count,FORMATETC[] output,int[] fetched) {
        int n=0;while(n<count && position<formats.Length)output[n++]=formats[position++];
        if(fetched!=null)fetched[0]=n;return n==count?0:1;
    }
    public int Skip(int count) { int old=position;position=Math.Min(formats.Length,position+count);return position-old==count?0:1; }
    public int Reset() { position=0;return 0; }
    public void Clone(out IEnumFORMATETC result) { var clone=new FormatEnumerator(formats);clone.position=position;result=clone; }
}

[ComVisible(true), ClassInterface(ClassInterfaceType.None), ComDefaultInterface(typeof(IDataObject))]
public sealed class VirtualFiles : IDataObject,IDataObjectAsyncCapability {
    private readonly List<Entry> entries;
    private readonly short descriptor=Native.Format("FileGroupDescriptorW");
    private readonly short contents=Native.Format("FileContents");
    private readonly short effect=Native.Format("Preferred DropEffect");
    internal bool Active;
    internal bool Ended;
    internal bool Success;
    private bool asyncMode=true;
    internal VirtualFiles(List<Entry> entries) { this.entries=entries; }
    private FORMATETC Format(short id,TYMED medium,int index) { return new FORMATETC { cfFormat=id,dwAspect=DVASPECT.DVASPECT_CONTENT,lindex=index,tymed=medium,ptd=IntPtr.Zero }; }
    internal byte[] Descriptors() {
        using(var stream=new MemoryStream())using(var writer=new BinaryWriter(stream)) {
            writer.Write(entries.Count);
            foreach(var entry in entries) {
                writer.Write((uint)(0x4|0x40|0x4000));
                writer.Write(new byte[16+8+8]);
                writer.Write((uint)(entry.Directory?0x10:0x80));
                writer.Write(new byte[24]);
                writer.Write((uint)(entry.Size>>32));writer.Write((uint)entry.Size);
                var name=Encoding.Unicode.GetBytes(entry.Name.Replace('/','\\'));
                if(name.Length>518)throw new InvalidDataException("Path exceeds Explorer virtual-file limit");
                writer.Write(name);writer.Write(new byte[520-name.Length]);
            }
            return stream.ToArray();
        }
    }
    public void GetData(ref FORMATETC format,out STGMEDIUM medium) {
        if(Bridge.Trace!=null)Bridge.Trace("GetData "+format.cfFormat+" index="+format.lindex+" medium="+format.tymed);
        medium=new STGMEDIUM();
        if(QueryGetData(ref format)!=0)throw new COMException("Unsupported format",unchecked((int)0x80040064));
        if(format.cfFormat==contents) {
            var entry=entries[format.lindex];
            medium.tymed=TYMED.TYMED_ISTREAM;
            medium.unionmember=Marshal.GetComInterfaceForObject(new RemoteStream(format.lindex,entry.Size),typeof(IStream));
        } else {
            medium.tymed=TYMED.TYMED_HGLOBAL;
            medium.unionmember=Native.Memory(format.cfFormat==descriptor?Descriptors():BitConverter.GetBytes((uint)1));
        }
    }
    public int QueryGetData(ref FORMATETC format) {
        if(format.dwAspect!=DVASPECT.DVASPECT_CONTENT)return unchecked((int)0x8004006B);
        if((format.cfFormat==descriptor||format.cfFormat==effect)&&(format.tymed&TYMED.TYMED_HGLOBAL)!=0)return 0;
        if(format.cfFormat==contents&&(format.tymed&TYMED.TYMED_ISTREAM)!=0&&format.lindex>=0&&format.lindex<entries.Count)return 0;
        return unchecked((int)0x80040064);
    }
    public IEnumFORMATETC EnumFormatEtc(DATADIR direction) {
        if(direction!=DATADIR.DATADIR_GET)throw new NotSupportedException();
        return new FormatEnumerator(new[]{Format(descriptor,TYMED.TYMED_HGLOBAL,-1),Format(contents,TYMED.TYMED_ISTREAM,-1),Format(effect,TYMED.TYMED_HGLOBAL,-1)});
    }
    public void GetDataHere(ref FORMATETC format,ref STGMEDIUM medium) { throw new NotSupportedException(); }
    public int GetCanonicalFormatEtc(ref FORMATETC input,out FORMATETC output) { output=input;output.ptd=IntPtr.Zero;return 0x40130; }
    public void SetData(ref FORMATETC format,ref STGMEDIUM medium,bool release) { if(release)Native.ReleaseStgMedium(ref medium); }
    public int DAdvise(ref FORMATETC format,ADVF flags,IAdviseSink sink,out int connection) { connection=0;return unchecked((int)0x80040003); }
    public void DUnadvise(int connection) { }
    public int EnumDAdvise(out IEnumSTATDATA result) { result=null;return unchecked((int)0x80040003); }
    public void SetAsyncMode(bool value) { asyncMode=value; }
    public void GetAsyncMode(out bool value) { value=asyncMode; }
    public void StartOperation(IBindCtx context) { Active=true; }
    public void InOperation(out bool value) { value=Active; }
    public void EndOperation(int result,IBindCtx context,uint effects) { Success=result>=0&&(effects&1)!=0;Active=false;Ended=true; }
}

internal static class Program {
    [STAThread] private static int Main(string[] args) {
        if(args.Length<1)return 2;
        try {
            Uri endpoint=new Uri(args[0]);
            if(endpoint.Host!="127.0.0.1"||endpoint.Scheme!="http")return 2;
            Bridge.Url=args[0];
            var json=new JavaScriptSerializer().DeserializeObject(Encoding.UTF8.GetString(Bridge.Read(""))) as Dictionary<string,object>;
            var entries=new List<Entry>();
            foreach(var item in (object[])json["files"]) {
                var value=(Dictionary<string,object>)item;
                entries.Add(new Entry {Name=(string)value["name"],Size=Convert.ToInt64(value["size"]),Directory=(bool)value["directory"]});
            }
            var files=new VirtualFiles(entries);
            Native.OleInitialize(IntPtr.Zero);
            try {
                if(args.Length>1&&args[1]=="--probe") {
                    if(args.Length<3)return 2;
                    Directory.CreateDirectory(args[2]);
                    for(int i=0;i<entries.Count;i++) {
                        var target=Path.Combine(args[2],entries[i].Name.Replace('/',Path.DirectorySeparatorChar));
                        if(entries[i].Directory){Directory.CreateDirectory(target);continue;}
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        var stream=new RemoteStream(i,entries[i].Size);
                        IntPtr read=Marshal.AllocHGlobal(4);
                        try { using(var output=new FileStream(target,FileMode.CreateNew)) { var buffer=new byte[65536];while(true){stream.Read(buffer,buffer.Length,read);int n=Marshal.ReadInt32(read);if(n==0)break;output.Write(buffer,0,n);} } }
                        finally {Marshal.FreeHGlobal(read);}
                    }
                    Bridge.Done(true);return 0;
                }
                if((Native.GetAsyncKeyState(1)&0x8000)==0){Bridge.Done(false);return 1;}
                uint effect;int result=Native.DoDragDrop(files,new DropSource(),1,out effect);
                while(files.Active) { Application.DoEvents();System.Threading.Thread.Sleep(10); }
                bool success=files.Ended?files.Success:result==0x40100&&(effect&1)!=0;
                Bridge.Done(success);return success?0:1;
            } finally { Native.OleUninitialize(); }
        } catch(Exception error) {
            if(args.Length>1&&args[1]=="--probe")Console.Error.WriteLine(error.Message);
            Bridge.Done(false);return 3;
        }
    }
}
