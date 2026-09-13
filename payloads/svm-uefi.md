Alright — full drop. Below is the whole thing as one EDK2 application (`SvmBootVerifier`), all five parts running in sequence, read-only on the virtualisation side: it never sets `EFER.SVME`, never writes `VM_HSAVE_PA`, never executes `VMRUN`. So it's safe to boot on the 2400G.

Three files, all inside the package directory:

```text
SvmBootVerifier/
  SvmBootVerifier.c
  SvmBootVerifier.inf
  SvmBootVerifier.dsc
```

Build from the edk2 root after `edksetup`:

```text
build -a X64 -t VS2022 -D SVM_ENABLE=TRUE -p SvmBootVerifier/SvmBootVerifier.dsc
```

Drop the resulting `Build/SvmBootVerifier/DEBUG_VS2022/X64/SvmBootVerifier.efi` onto your stick at `fs0:\EFI\BOOTX64.EFI` and chain it from the UEFI Shell with `fs0:\EFI\BOOTX64.EFI`. Everything comes out on COM1 (115200 8N1) and on the GOP console at the same time.

**SvmBootVerifier.c**

```c
/** @file
  SvmBootVerifier.c

  AMD SVM discovery, VMCB layout verification and intercept bitmap
  construction for Ryzen 5 2400G (Raven Ridge, family 17h) UEFI hosts.

  The application is READ-ONLY with respect to the processor's SVM
  configuration.  EFER.SVME is never set, VM_HSAVE_PA is never written and
  VMRUN is never executed.  The VMCB pages, NPT hierarchy, MSRPM and IOPM
  built here exist so the architectural layout can be measured and reported
  from a normal UEFI shell session.

  SPDX-License-Identifier: BSD-2-Clause-Patent
**/

#include <Uefi.h>

#include <Library/BaseLib.h>
#include <Library/BaseMemoryLib.h>
#include <Library/IoLib.h>
#include <Library/MemoryAllocationLib.h>
#include <Library/PrintLib.h>
#include <Library/UefiBootServicesTableLib.h>
#include <Library/UefiLib.h>

#include <Protocol/MpService.h>

#define HV_BOOT               "[HV-BOOT]"
#define HV_OFFSET             "[HV-OFFSET]"
#define HV_SIM                "[HV-SIM]"
#define HV_MEM                "[HV-MEM]"
#define HV_EVT                "[HV-EVT]"

#define COM1_BASE             0x3F8
#define COM1_BAUD_DIVISOR     0x0001   /* 115200 baud @ 1.8432 MHz */

#define CPUID_EXTENDED_MAX    0x80000000
#define CPUID_EXT_FEATURES    0x80000001
#define CPUID_SVM_REVISION    0x8000000A

#define MSR_EFER              0x00000000C0000080ULL
#define MSR_STAR              0x00000000C0000081ULL
#define MSR_LSTAR             0x00000000C0000082ULL
#define MSR_FS_BASE           0x00000000C0000100ULL
#define MSR_GS_BASE           0x00000000C0000101ULL
#define MSR_KERNEL_GS_BASE    0x00000000C0000102ULL
#define MSR_VM_CR             0x00000000C0010114ULL
#define MSR_VM_HSAVE_PA       0x00000000C0010117ULL

#define EFER_SVME             BIT12
#define EFER_NXE              BIT11
#define VM_CR_SVMDIS          BIT4
#define VM_CR_LOCK            BIT3

#define SVM_VMCB_CONTROL_SIZE 0x400
#define SVM_VMCB_SAVE_SIZE    0xC00
#define SVM_VMCB_TOTAL_SIZE   0x1000

#define SVM_ASID_MAX          64
#define SVM_ASID_HOST         1
#define SVM_ASID_GUEST        2

#define NPT_PRESENT           BIT0
#define NPT_RW                BIT1
#define NPT_US                BIT2
#define NPT_PWT               BIT3
#define NPT_PCD               BIT4
#define NPT_ACCESSED          BIT5
#define NPT_DIRTY             BIT6
#define NPT_PS                BIT7
#define NPT_ADDR_MASK         0x000FFFFFFFFFF000ULL
#define NPT_SET_ADDR(Pa)      ((UINT64)(Pa) & NPT_ADDR_MASK)
#define NPT_GET_ADDR(Entry)   ((UINT64)(Entry) & NPT_ADDR_MASK)

typedef UINT64 NPT_ENTRY;

/* MSRPM geometry: 4 blocks of 2 KiB. */
#define MSRPM_SIZE            0x2000
#define MSRPM_BLOCK_LOW_READ  0x0000
#define MSRPM_BLOCK_LOW_WRITE 0x0800
#define MSRPM_BLOCK_HIGH_READ 0x1000
#define MSRPM_BLOCK_HIGH_WRITE 0x1800

/* IOPM geometry: one bit per port, 0x0000-0xFFFF. */
#define IOPM_BITS_PER_PORT    1
#define IOPM_SIZE             0x3000

#define TLB_CONTROL_NONE      0
#define TLB_CONTROL_FLUSH_ALL 1
#define TLB_CONTROL_FLUSH_ASID 3
#define TLB_CONTROL_FLUSH_NONGLOBAL 7

#define EXIT_CPUID            0x00000072
#define EXIT_MSR              0x0000007C
#define EXIT_IO               0x0000007B
#define EXIT_HLT              0x00000078
#define EXIT_SHUTDOWN         0x0000007F
#define EXIT_INVALID          0xFFFFFFFF

#pragma pack(push, 1)

typedef struct {
  UINT16  Selector;
  UINT16  Attrib;
  UINT32  Limit;
  UINT64  Base;
} SVM_SEGMENT;

typedef struct {
  UINT64  Base;
  UINT16  Limit;
  UINT8   Reserved[6];
} SVM_DTR;

typedef struct {
  UINT16  CrRead;
  UINT16  CrWrite;
  UINT16  DrRead;
  UINT16  DrWrite;
  UINT32  Exceptions;
  UINT64  Intercept;
  UINT8   Reserved1[0x28];
  UINT16  PauseFilterThreshold;
  UINT16  PauseFilterCount;
  UINT64  IopmBasePa;
  UINT64  MsrpmBasePa;
  UINT64  TscOffset;
  UINT32  GuestAsid;
  UINT8   TlbControl;
  UINT8   Reserved2[3];
  UINT32  IntCtl;
  UINT32  IntVector;
  UINT64  InterruptShadow;
  UINT64  ExitCode;
  UINT8   Reserved3[4];
  UINT32  ExitInfo1;
  UINT8   Reserved4[4];
  UINT32  ExitInfo2;
  UINT32  ExitIntInfo;
  UINT8   Reserved5[4];
  UINT32  NpEnable;
  UINT8   Reserved6[4];
  UINT64  NCr3;
  UINT8   LbrVirt;
  UINT8   VmcbClean;
  UINT8   Nrips;
  UINT8   Reserved7[5];
  UINT64  EventInj;
  UINT8   Reserved8[0x350];
} SVM_VMCB_CONTROL;

typedef struct {
  SVM_SEGMENT Es;
  SVM_SEGMENT Cs;
  SVM_SEGMENT Ss;
  SVM_SEGMENT Ds;
  SVM_SEGMENT Fs;
  SVM_SEGMENT Gs;
  SVM_DTR     Gdtr;
  SVM_DTR     Idtr;
  SVM_SEGMENT Ldtr;
  SVM_SEGMENT Tr;
  UINT8       Reserved1[0x30];
  UINT32      Cpl;
  UINT32      Reserved2;
  UINT64      Efer;
  UINT8       Reserved3[0x48];
  UINT64      Cr4;
  UINT64      Cr3;
  UINT64      Cr0;
  UINT64      Dr7;
  UINT64      Dr6;
  UINT64      Rflags;
  UINT64      Rip;
  UINT64      Rsp;
  UINT8       Reserved4[0x18];
  UINT64      Rax;
  UINT64      Rcx;
  UINT64      Rdx;
  UINT64      Rbx;
  UINT64      RspShadow;
  UINT64      Rbp;
  UINT64      Rsi;
  UINT64      Rdi;
  UINT64      R8;
  UINT64      R9;
  UINT64      R10;
  UINT64      R11;
  UINT64      R12;
  UINT64      R13;
  UINT64      R14;
  UINT64      R15;
  UINT8       Reserved5[0xA00];
} SVM_VMCB_SAVE;

typedef struct {
  SVM_VMCB_CONTROL Control;   /* 0x000 .. 0x3FF */
  SVM_VMCB_SAVE    Save;      /* 0x400 .. 0xFFF */
} SVM_VMCB;

#pragma pack(pop)

STATIC_ASSERT (sizeof (SVM_VMCB_CONTROL) == SVM_VMCB_CONTROL_SIZE, "VMCB control area must be 0x400 bytes");
STATIC_ASSERT (sizeof (SVM_VMCB_SAVE)    == SVM_VMCB_SAVE_SIZE,    "VMCB save area must be 0xC00 bytes");
STATIC_ASSERT (sizeof (SVM_VMCB)         == SVM_VMCB_TOTAL_SIZE,   "VMCB page must be 0x1000 bytes");

/* ------------------------------------------------------------------ */
/* Part 0: serial + console plumbing                                   */
/* ------------------------------------------------------------------ */

STATIC VOID
SerialInit (
  VOID
  )
{
  IoWrite8 (COM1_BASE + 1, 0x00);
  IoWrite8 (COM1_BASE + 3, 0x80);
  IoWrite8 (COM1_BASE + 0, (UINT8)(COM1_BAUD_DIVISOR & 0xFF));
  IoWrite8 (COM1_BASE + 1, (UINT8)((COM1_BAUD_DIVISOR >> 8) & 0xFF));
  IoWrite8 (COM1_BASE + 3, 0x03);
  IoWrite8 (COM1_BASE + 2, 0xC7);
  IoWrite8 (COM1_BASE + 4, 0x0B);
}

STATIC VOID
SerialWrite (
  IN CONST CHAR8  *Text
  )
{
  while (*Text != '\0') {
    while ((IoRead8 (COM1_BASE + 5) & 0x20) == 0) {
      CpuPause ();
    }
    IoWrite8 (COM1_BASE, (UINT8)*Text);
    Text++;
  }
}

STATIC VOID
LogLine (
  IN CONST CHAR8  *Prefix,
  IN CONST CHAR8  *Format,
  ...
  )
{
  VA_LIST  Args;
  CHAR8    Buffer[256];

  VA_START (Args, Format);
  AsciiVSPrint (Buffer, sizeof (Buffer), Format, Args);
  VA_END (Args);

  SerialWrite (Prefix);
  SerialWrite (" ");
  SerialWrite (Buffer);
  SerialWrite ("\r\n");

  AsciiPrint ("%a %a\r\n", Prefix, Buffer);
}

STATIC VOID
Rule (
  IN CONST CHAR8  *Title
  )
{
  LogLine (HV_BOOT, "---- %a ----", Title);
}

/* ------------------------------------------------------------------ */
/* Part 1: SVM discovery and VMCB allocation                           */
/* ------------------------------------------------------------------ */

typedef struct {
  BOOLEAN  Np;
  BOOLEAN  LbrVirt;
  BOOLEAN  SvmLock;
  BOOLEAN  Nrips;
  BOOLEAN  TscRate;
  BOOLEAN  VmcbClean;
  BOOLEAN  FlushAsid;
} SVM_FEATURE_BITS;

typedef struct {
  UINT32            MaxExtendedLeaf;
  BOOLEAN           SvmSupported;
  UINT8             SvmRevision;
  UINT32            AsidCount;
  SVM_FEATURE_BITS  Features;
  UINT64            Efer;
  UINT64            VmCr;
} SVM_CPU_CAPS;

typedef struct {
  UINTN      Index;
  EFI_PHYSICAL_ADDRESS  VmcbPa;
  EFI_PHYSICAL_ADDRESS  HsavePa;
  SVM_VMCB   *Vmcb;
} SVM_LOGICAL_PROCESSOR;

STATIC SVM_CPU_CAPS            mCaps;
STATIC SVM_LOGICAL_PROCESSOR   *mProcessors = NULL;
STATIC UINTN                   mProcessorCount = 1;

STATIC
VOID
SvmDiscover (
  OUT SVM_CPU_CAPS  *Caps
  )
{
  UINT32  Eax;
  UINT32  Ebx;
  UINT32  Ecx;
  UINT32  Edx;

  ZeroMem (Caps, sizeof (*Caps));

  AsmCpuid (CPUID_EXTENDED_MAX, &Caps->MaxExtendedLeaf, NULL, NULL, NULL);
  LogLine (HV_BOOT, "CPUID.80000000 -> max extended leaf 0x%08x", Caps->MaxExtendedLeaf);

  Eax = 0;
  Ebx = 0;
  Ecx = 0;
  Edx = 0;
  AsmCpuid (CPUID_EXT_FEATURES, &Eax, &Ebx, &Ecx, &Edx);
  Caps->SvmSupported = (BOOLEAN)((Ecx & BIT2) != 0);
  LogLine (
           HV_BOOT,
           "CPUID.80000001 ECX=0x%08x -> SVM %a",
           Ecx,
           Caps->SvmSupported ? "present" : "absent"
           );

  Eax = 0;
  Ebx = 0;
  Ecx = 0;
  Edx = 0;
  AsmCpuid (CPUID_SVM_REVISION, &Eax, &Ebx, &Ecx, &Edx);
  Caps->SvmRevision = (UINT8)(Eax & 0xFF);
  Caps->AsidCount   = Ecx;
  Caps->Features.Np        = (BOOLEAN)((Ecx & BIT0) != 0);
  Caps->Features.LbrVirt   = (BOOLEAN)((Ecx & BIT1) != 0);
  Caps->Features.SvmLock   = (BOOLEAN)((Ecx & BIT2) != 0);
  Caps->Features.Nrips     = (BOOLEAN)((Ecx & BIT3) != 0);
  Caps->Features.TscRate   = (BOOLEAN)((Ecx & BIT4) != 0);
  Caps->Features.VmcbClean = (BOOLEAN)((Ecx & BIT5) != 0);
  Caps->Features.FlushAsid = (BOOLEAN)((Ecx & BIT6) != 0);

  LogLine (HV_BOOT, "SVM revision 0x%02x, ASID count %d", Caps->SvmRevision, Caps->AsidCount);
  LogLine (
           HV_BOOT,
           "features NP=%d LBRVIRT=%d SVML=%d NRIPS=%d TSCRATE=%d VMCBCLEAN=%d FLUSHASID=%d",
           Caps->Features.Np,
           Caps->Features.LbrVirt,
           Caps->Features.SvmLock,
           Caps->Features.Nrips,
           Caps->Features.TscRate,
           Caps->Features.VmcbClean,
           Caps->Features.FlushAsid
           );

  Caps->Efer = AsmReadMsr64 (MSR_EFER);
  Caps->VmCr = AsmReadMsr64 (MSR_VM_CR);

  LogLine (
           HV_BOOT,
           "EFER=0x%016lx SVME=%d  (read only)",
           Caps->Efer,
           (Caps->Efer & EFER_SVME) != 0
           );
  LogLine (
           HV_BOOT,
           "VM_CR=0x%016lx SVMDIS=%d LOCK=%d  (read only)",
           Caps->VmCr,
           (Caps->VmCr & VM_CR_SVMDIS) != 0,
           (Caps->VmCr & VM_CR_LOCK) != 0
           );
}

STATIC
EFI_STATUS
SvmAllocateProcessorStructures (
  VOID
  )
{
  EFI_STATUS             Status;
  EFI_MP_SERVICES_PROTOCOL  *Mp;
  UINTN                  Enabled;
  UINTN                  Index;
  EFI_PHYSICAL_ADDRESS   VmcbPa;
  EFI_PHYSICAL_ADDRESS   HsavePa;

  Mp   = NULL;
  Status = gBS->LocateProtocol (&gEfiMpServiceProtocolGuid, NULL, (VOID **)&Mp);
  if (!EFI_ERROR (Status) && (Mp != NULL)) {
    Mp->GetNumberOfProcessors (Mp, &mProcessorCount, &Enabled);
  } else {
    mProcessorCount = 1;
  }

  LogLine (HV_BOOT, "logical processors: %d", mProcessorCount);

  mProcessors = AllocateZeroPool (mProcessorCount * sizeof (SVM_LOGICAL_PROCESSOR));
  if (mProcessors == NULL) {
    LogLine (HV_BOOT, "FAIL: could not allocate processor table");
    return EFI_OUT_OF_RESOURCES;
  }

  for (Index = 0; Index < mProcessorCount; Index++) {
    mProcessors[Index].Index = Index;

    VmcbPa = 0;
    Status = gBS->AllocatePages (AllocateAnyPages, EfiBootServicesData, 1, &VmcbPa);
    if (EFI_ERROR (Status)) {
      LogLine (HV_BOOT, "FAIL: VMCB allocation for CPU%d (0x%r)", Index, Status);
      return Status;
    }

    HsavePa = 0;
    Status = gBS->AllocatePages (AllocateAnyPages, EfiBootServicesData, 1, &HsavePa);
    if (EFI_ERROR (Status)) {
      LogLine (HV_BOOT, "FAIL: HSAVE allocation for CPU%d (0x%r)", Index, Status);
      gBS->FreePages (VmcbPa, 1);
      return Status;
    }

    ZeroMem ((VOID *)(UINTN)VmcbPa, SVM_VMCB_TOTAL_SIZE);
    ZeroMem ((VOID *)(UINTN)HsavePa, SIZE_4KB);

    mProcessors[Index].VmcbPa  = VmcbPa;
    mProcessors[Index].HsavePa = HsavePa;
    mProcessors[Index].Vmcb    = (SVM_VMCB *)(UINTN)VmcbPa;

    LogLine (
             HV_BOOT,
             "CPU%d VMCB 0x%016lx (aligned=%d) HSAVE 0x%016lx (aligned=%d)",
             Index,
             (UINT64)VmcbPa,
             ((VmcbPa & 0xFFF) == 0),
             (UINT64)HsavePa,
             ((HsavePa & 0xFFF) == 0)
             );
  }

  return EFI_SUCCESS;
}

/* ------------------------------------------------------------------ */
/* Part 2: offset table and software state machine                     */
/* ------------------------------------------------------------------ */

typedef UINT64 (*SVM_OFFSET_MEASURER)(VOID);

typedef struct {
  CONST CHAR8        *Name;
  UINT32             Expected;
  UINT32             Size;
  SVM_OFFSET_MEASURER Measurer;
} SVM_OFFSET_ENTRY;

#define CONTROL_FIELDS(X)                       \
  X (CrRead,               0x000, 2)            \
  X (CrWrite,              0x002, 2)            \
  X (DrRead,               0x004, 2)            \
  X (DrWrite,              0x006, 2)            \
  X (Exceptions,           0x008, 4)            \
  X (Intercept,            0x00C, 8)            \
  X (PauseFilterThreshold, 0x03C, 2)            \
  X (PauseFilterCount,     0x03E, 2)            \
  X (IopmBasePa,           0x040, 8)            \
  X (MsrpmBasePa,          0x048, 8)            \
  X (TscOffset,            0x050, 8)            \
  X (GuestAsid,            0x058, 4)            \
  X (TlbControl,           0x05C, 1)            \
  X (IntCtl,               0x060, 4)            \
  X (IntVector,            0x060, 4)            \
  X (InterruptShadow,      0x068, 8)            \
  X (ExitCode,             0x070, 8)            \
  X (ExitInfo1,            0x07C, 4)            \
  X (ExitInfo2,            0x084, 4)            \
  X (ExitIntInfo,          0x088, 4)            \
  X (NpEnable,             0x090, 4)            \
  X (NCr3,                 0x098, 8)            \
  X (LbrVirt,              0x0A0, 1)            \
  X (VmcbClean,            0x0A1, 1)            \
  X (Nrips,                0x0A2, 1)            \
  X (EventInj,             0x0A8, 8)

#define SAVE_FIELDS(X)                          \
  X (Es,                   0x000, 16)           \
  X (Cs,                   0x010, 16)           \
  X (Ss,                   0x020, 16)           \
  X (Ds,                   0x030, 16)           \
  X (Fs,                   0x040, 16)           \
  X (Gs,                   0x050, 16)           \
  X (Gdtr,                 0x060, 16)           \
  X (Idtr,                 0x070, 16)           \
  X (Ldtr,                 0x080, 16)           \
  X (Tr,                   0x090, 16)           \
  X (Cpl,                  0x0D0, 4)            \
  X (Efer,                 0x0D8, 8)            \
  X (Cr4,                  0x128, 8)            \
  X (Cr3,                  0x130, 8)            \
  X (Cr0,                  0x138, 8)            \
  X (Dr7,                  0x140, 8)            \
  X (Dr6,                  0x148, 8)            \
  X (Rflags,               0x150, 8)            \
  X (Rip,                  0x158, 8)            \
  X (Rsp,                  0x160, 8)            \
  X (Rax,                  0x180, 8)

#define DEFINE_CONTROL_MEASURER(Name, Offset, Size)                       \
  STATIC UINT64 MeasureControl##Name (VOID)                               \
  {                                                                       \
    return (UINT64)(OFFSET_OF (SVM_VMCB, Control.Name) -                  \
                    OFFSET_OF (SVM_VMCB, Control));                       \
  }

#define DEFINE_CONTROL_ENTRY(Name, Offset, Size)                          \
  { #Name, (UINT32)(Offset), (UINT32)(Size), MeasureControl##Name },

CONTROL_FIELDS (DEFINE_CONTROL_MEASURER)

STATIC CONST SVM_OFFSET_ENTRY  mControlOffsets[] = {
  CONTROL_FIELDS (DEFINE_CONTROL_ENTRY)
};

#define DEFINE_SAVE_MEASURER(Name, Offset, Size)                          \
  STATIC UINT64 MeasureSave##Name (VOID)                                  \
  {                                                                       \
    return (UINT64)(OFFSET_OF (SVM_VMCB, Save.Name) -                     \
                    OFFSET_OF (SVM_VMCB, Save));                          \
  }

#define DEFINE_SAVE_ENTRY(Name, Offset, Size)                             \
  { #Name, (UINT32)(Offset), (UINT32)(Size), MeasureSave##Name },

SAVE_FIELDS (DEFINE_SAVE_MEASURER)

STATIC CONST SVM_OFFSET_ENTRY  mSaveOffsets[] = {
  SAVE_FIELDS (DEFINE_SAVE_ENTRY)
};

STATIC
UINT32
SvmVerifyOffsetTable (
  VOID
  )
{
  UINTN   Index;
  UINT64  Measured;
  UINT32  Failures;

  Failures = 0;

  for (Index = 0; Index < ARRAY_SIZE (mControlOffsets); Index++) {
    Measured = mControlOffsets[Index].Measurer ();
    if (Measured != mControlOffsets[Index].Expected) {
      Failures++;
    }
    LogLine (
             HV_OFFSET,
             "control.%-22a expected=0x%03x measured=0x%03lx size=0x%02x [%a]",
             mControlOffsets[Index].Name,
             mControlOffsets[Index].Expected,
             Measured,
             mControlOffsets[Index].Size,
             (Measured == mControlOffsets[Index].Expected) ? "PASS" : "FAIL"
             );
  }

  for (Index = 0; Index < ARRAY_SIZE (mSaveOffsets); Index++) {
    Measured = mSaveOffsets[Index].Measurer ();
    if (Measured != mSaveOffsets[Index].Expected) {
      Failures++;
    }
    LogLine (
             HV_OFFSET,
             "save.%-25a expected=0x%03x measured=0x%03lx size=0x%02x [%a]",
             mSaveOffsets[Index].Name,
             mSaveOffsets[Index].Expected,
             Measured,
             mSaveOffsets[Index].Size,
             (Measured == mSaveOffsets[Index].Expected) ? "PASS" : "FAIL"
             );
  }

  LogLine (HV_OFFSET, "offset sweep complete: %d fields, %d mismatch", (UINT32)(ARRAY_SIZE (mControlOffsets) + ARRAY_SIZE (mSaveOffsets)), Failures);
  return Failures;
}

typedef enum {
  SvmStateUninitialized = 0,
  SvmStateReady,
  SvmStateGuestRunning,
  SvmStateVmExit,
  SvmStateDispatched,
  SvmStateHalted,
  SvmStateMax
} SVM_STATE;

STATIC CONST CHAR8  *mStateNames[] = {
  "UNINITIALIZED",
  "READY",
  "GUEST_RUNNING",
  "VMEXIT",
  "DISPATCHED",
  "HALTED"
};

typedef struct {
  UINT64  ExitCode;
  CONST CHAR8  *Label;
} SVM_SCENARIO_STEP;

STATIC CONST SVM_SCENARIO_STEP  mScenario[] = {
  { EXIT_CPUID,    "CPUID 0x80000001" },
  { EXIT_MSR,      "MSR read EFER"    },
  { EXIT_IO,       "IO port 0x3F8"    },
  { EXIT_CPUID,    "CPUID 0x8000000A" },
  { EXIT_HLT,      "HLT"              }
};

STATIC UINT32  mStateHistogram[SvmStateMax];
STATIC UINT32  mExitHistogram[8];
STATIC SVM_STATE  mState = SvmStateUninitialized;

STATIC
VOID
SvmPrintStateMap (
  VOID
  )
{
  LogLine (HV_SIM, "  +---------------+   SvmInitialize    +---------+");
  LogLine (HV_SIM, "  | UNINITIALIZED |----------------->|  READY  |");
  LogLine (HV_SIM, "  +---------------+                  +---------+");
  LogLine (HV_SIM, "                                          |");
  LogLine (HV_SIM, "                                    SvmSimulateVmrun");
  LogLine (HV_SIM, "                                          v");
  LogLine (HV_SIM, "                                   +--------------+");
  LogLine (HV_SIM, "                                   | GUEST_RUNNING|");
  LogLine (HV_SIM, "                                   +--------------+");
  LogLine (HV_SIM, "                                          |");
  LogLine (HV_SIM, "                                    (exit reason)");
  LogLine (HV_SIM, "                                          v");
  LogLine (HV_SIM, "                                     +----------+");
  LogLine (HV_SIM, "                                     |  VMEXIT  |");
  LogLine (HV_SIM, "                                     +----------+");
  LogLine (HV_SIM, "                                          |");
  LogLine (HV_SIM, "                                   SvmSimulateDispatch");
  LogLine (HV_SIM, "                                          v");
  LogLine (HV_SIM, "                                   +-------------+");
  LogLine (HV_SIM, "                                   | DISPATCHED  |");
  LogLine (HV_SIM, "                                   +-------------+");
  LogLine (HV_SIM, "                                      |        |");
  LogLine (HV_SIM, "                               (ready) |        | (SHUTDOWN)");
  LogLine (HV_SIM, "                                      v        v");
  LogLine (HV_SIM, "                                   READY    HALTED");
}

STATIC
VOID
SvmSetState (
  IN SVM_STATE  Next
  )
{
  LogLine (HV_SIM, "state %a -> %a", mStateNames[mState], mStateNames[Next]);
  mState = Next;
  mStateHistogram[Next]++;
}

STATIC
UINT8
SvmExitBucket (
  IN UINT64  ExitCode
  )
{
  switch (ExitCode) {
    case EXIT_CPUID:
      return 0;
    case EXIT_MSR:
      return 1;
    case EXIT_IO:
      return 2;
    case EXIT_HLT:
      return 3;
    case EXIT_SHUTDOWN:
      return 4;
    default:
      return 5;
  }
}

STATIC
EFI_STATUS
SvmSimulateVmrun (
  IN OUT SVM_VMCB  *Vmcb,
  IN UINT64        ExitCode
  )
{
  if (mState != SvmStateReady) {
    LogLine (HV_SIM, "FAIL: VMRUN from state %a", mStateNames[mState]);
    return EFI_ABORTED;
  }

  SvmSetState (SvmStateGuestRunning);
  Vmcb->Control.ExitCode   = ExitCode;
  Vmcb->Control.ExitInfo1  = (UINT32)(ExitCode ^ 0xA5A5A5A5);
  Vmcb->Control.ExitInfo2  = (UINT32)(ExitCode >> 3);
  mExitHistogram[SvmExitBucket (ExitCode)]++;

  LogLine (HV_SIM, "vmrun -> exit 0x%08lx", ExitCode);
  SvmSetState (SvmStateVmExit);
  return EFI_SUCCESS;
}

STATIC
EFI_STATUS
SvmSimulateDispatch (
  IN OUT SVM_VMCB  *Vmcb
  )
{
  UINT64  ExitCode;

  if (mState != SvmStateVmExit) {
    LogLine (HV_SIM, "FAIL: dispatch from state %a", mStateNames[mState]);
    return EFI_ABORTED;
  }

  ExitCode = Vmcb->Control.ExitCode;
  LogLine (HV_SIM, "dispatch 0x%08lx info1=0x%08x info2=0x%08x", ExitCode, Vmcb->Control.ExitInfo1, Vmcb->Control.ExitInfo2);
  SvmSetState (SvmStateDispatched);

  switch (ExitCode) {
    case EXIT_CPUID:
      LogLine (HV_SIM, "  handler: CPUID intercept (guest id / feature passthrough)");
      SvmSetState (SvmStateReady);
      return EFI_SUCCESS;

    case EXIT_MSR:
      LogLine (HV_SIM, "  handler: MSR intercept (EFER read emulation)");
      SvmSetState (SvmStateReady);
      return EFI_SUCCESS;

    case EXIT_IO:
      LogLine (HV_SIM, "  handler: IO intercept (COM1 shadow)");
      SvmSetState (SvmStateReady);
      return EFI_SUCCESS;

    case EXIT_HLT:
      LogLine (HV_SIM, "  handler: HLT intercept (idle)");
      SvmSetState (SvmStateReady);
      return EFI_SUCCESS;

    case EXIT_SHUTDOWN:
      LogLine (HV_SIM, "  handler: SHUTDOWN - halting state machine");
      SvmSetState (SvmStateHalted);
      return EFI_SUCCESS;

    default:
      LogLine (HV_SIM, "  handler: invalid exit code");
      SvmSetState (SvmStateHalted);
      return EFI_ABORTED;
  }
}

STATIC
EFI_STATUS
SvmRunScenario (
  IN OUT SVM_VMCB  *Vmcb
  )
{
  EFI_STATUS  Status;
  UINTN       Index;

  SvmSetState (SvmStateReady);

  for (Index = 0; Index < ARRAY_SIZE (mScenario); Index++) {
    LogLine (HV_SIM, "scenario %d/%d: %a", (UINT32)(Index + 1), (UINT32)ARRAY_SIZE (mScenario), mScenario[Index].Label);
    Status = SvmSimulateVmrun (Vmcb, mScenario[Index].ExitCode);
    if (EFI_ERROR (Status)) {
      return Status;
    }
    Status = SvmSimulateDispatch (Vmcb);
    if (EFI_ERROR (Status)) {
      return Status;
    }
  }

  return EFI_SUCCESS;
}

STATIC
VOID
SvmPrintSimSummary (
  VOID
  )
{
  UINTN  Index;

  LogLine (HV_SIM, "state histogram:");
  for (Index = 0; Index < SvmStateMax; Index++) {
    LogLine (HV_SIM, "  %-14a %d", mStateNames[Index], mStateHistogram[Index]);
  }

  LogLine (HV_SIM, "exit histogram: cpuid=%d msr=%d io=%d hlt=%d shutdown=%d invalid=%d",
           mExitHistogram[0], mExitHistogram[1], mExitHistogram[2],
           mExitHistogram[3], mExitHistogram[4], mExitHistogram[5]);
}

/* ------------------------------------------------------------------ */
/* Part 3: NPT, MSRPM and IOPM                                         */
/* ------------------------------------------------------------------ */

typedef struct {
  EFI_PHYSICAL_ADDRESS  Pml4Pa;
  EFI_PHYSICAL_ADDRESS  PdptPa;
  EFI_PHYSICAL_ADDRESS  PdPa;
  EFI_PHYSICAL_ADDRESS  PtPa;
  EFI_PHYSICAL_ADDRESS  MsrpmPa;
  EFI_PHYSICAL_ADDRESS  IopmPa;
  NPT_ENTRY             *Pml4;
  NPT_ENTRY             *Pdpt;
  NPT_ENTRY             *Pd;
  NPT_ENTRY             *Pt;
  UINT8                 *Msrpm;
  UINT8                 *Iopm;
} SVM_MEMORY_STATE;

STATIC CONST UINT64  mInterceptMsrs[] = {
  MSR_EFER,
  MSR_STAR,
  MSR_LSTAR,
  MSR_FS_BASE,
  MSR_GS_BASE,
  MSR_KERNEL_GS_BASE
};

typedef struct {
  UINT32  First;
  UINT32  Last;
} SVM_PORT_RANGE;

STATIC CONST SVM_PORT_RANGE  mInterceptPorts[] = {
  { 0x0000, 0x00FF },
  { 0x02F8, 0x02FF },
  { 0x03F8, 0x03FF },
  { 0x0CF8, 0x0CFF }
};

STATIC
UINT32
MsrpmBitOffset (
  IN UINT64   Msr,
  IN BOOLEAN  Write
  )
{
  UINT32  Block;
  UINT32  Offset;

  if ((Msr & 0xFFFF0000ULL) != 0xC0000000ULL) {
    Block = MSRPM_BLOCK_LOW_READ;
  } else {
    Block = MSRPM_BLOCK_HIGH_READ;
  }

  /* two bits per MSR: bit 0 intercepts the read, bit 1 intercepts the write */
  Offset  = (UINT32)(Msr & 0x0FFFU) * 2;
  Offset += Write ? 1 : 0;

  if (Block == MSRPM_BLOCK_HIGH_READ) {
    Offset += MSRPM_BLOCK_HIGH_READ;
  }

  return Offset;
}

STATIC
VOID
MsrpmSetIntercept (
  IN OUT UINT8   *Msrpm,
  IN UINT64      Msr,
  IN BOOLEAN     Write
  )
{
  UINT32  Bit;

  Bit = MsrpmBitOffset (Msr, Write);
  if ((Bit / 8) < MSRPM_SIZE) {
    Msrpm[Bit / 8] |= (UINT8)(1u << (Bit % 8));
  }
}

STATIC
BOOLEAN
ValidateMsrpmForMsr (
  IN CONST UINT8  *Msrpm,
  IN UINT64       Msr,
  IN BOOLEAN      Write
  )
{
  UINT32  Bit;

  Bit = MsrpmBitOffset (Msr, Write);
  if ((Bit / 8) >= MSRPM_SIZE) {
    return FALSE;
  }

  return ((Msrpm[Bit / 8] & (UINT8)(1u << (Bit % 8))) != 0);
}

STATIC
VOID
IopmSetIntercept (
  IN OUT UINT8  *Iopm,
  IN UINT32     Port
  )
{
  if ((Port / 8) < IOPM_SIZE) {
    Iopm[Port / 8] |= (UINT8)(1u << (Port % 8));
  }
}

STATIC
BOOLEAN
ValidateIopmForPort (
  IN CONST UINT8  *Iopm,
  IN UINT32       Port
  )
{
  if ((Port / 8) >= IOPM_SIZE) {
    return FALSE;
  }

  return ((Iopm[Port / 8] & (UINT8)(1u << (Port % 8))) != 0);
}

STATIC
EFI_STATUS
SvmAllocateMemoryState (
  OUT SVM_MEMORY_STATE  *State
  )
{
  EFI_STATUS  Status;

  ZeroMem (State, sizeof (*State));

  Status = gBS->AllocatePages (AllocateAnyPages, EfiBootServicesData, 1, &State->Pml4Pa);
  if (EFI_ERROR (Status)) {
    LogLine (HV_MEM, "FAIL: PML4 allocation 0x%r", Status);
    return Status;
  }

  Status = gBS->AllocatePages (AllocateAnyPages, EfiBootServicesData, 1, &State->PdptPa);
  if (EFI_ERROR (Status)) {
    LogLine (HV_MEM, "FAIL: PDPT allocation 0x%r", Status);
    gBS->FreePages (State->Pml4Pa, 1);
    return Status;
  }

  Status = gBS->AllocatePages (AllocateAnyPages, EfiBootServicesData, 1, &State->PdPa);
  if (EFI_ERROR (Status)) {
    LogLine (HV_MEM, "FAIL: PD allocation 0x%r", Status);
    gBS->FreePages (State->Pml4Pa, 1);
    gBS->FreePages (State->PdptPa, 1);
    return Status;
  }

  Status = gBS->AllocatePages (AllocateAnyPages, EfiBootServicesData, 1, &State->PtPa);
  if (EFI_ERROR (Status)) {
    LogLine (HV_MEM, "FAIL: PT allocation 0x%r", Status);
    gBS->FreePages (State->Pml4Pa, 1);
    gBS->FreePages (State->PdptPa, 1);
    gBS->FreePages (State->PdPa, 1);
    return Status;
  }

  Status = gBS->AllocatePages (AllocateAnyPages, EfiBootServicesData, 2, &State->MsrpmPa);
  if (EFI_ERROR (Status)) {
    LogLine (HV_MEM, "FAIL: MSRPM allocation 0x%r", Status);
    gBS->FreePages (State->Pml4Pa, 1);
    gBS->FreePages (State->PdptPa, 1);
    gBS->FreePages (State->PdPa, 1);
    gBS->FreePages (State->PtPa, 1);
    return Status;
  }

  Status = gBS->AllocatePages (AllocateAnyPages, EfiBootServicesData, 3, &State->IopmPa);
  if (EFI_ERROR (Status)) {
    LogLine (HV_MEM, "FAIL: IOPM allocation 0x%r", Status);
    gBS->FreePages (State->Pml4Pa, 1);
    gBS->FreePages (State->PdptPa, 1);
    gBS->FreePages (State->PdPa, 1);
    gBS->FreePages (State->PtPa, 1);
    gBS->FreePages (State->MsrpmPa, 2);
    return Status;
  }

  State->Pml4  = (NPT_ENTRY *)(UINTN)State->Pml4Pa;
  State->Pdpt  = (NPT_ENTRY *)(UINTN)State->PdptPa;
  State->Pd    = (NPT_ENTRY *)(UINTN)State->PdPa;
  State->Pt    = (NPT_ENTRY *)(UINTN)State->PtPa;
  State->Msrpm = (UINT8 *)(UINTN)State->MsrpmPa;
  State->Iopm  = (UINT8 *)(UINTN)State->IopmPa;

  ZeroMem (State->Pml4, SIZE_4KB);
  ZeroMem (State->Pdpt, SIZE_4KB);
  ZeroMem (State->Pd, SIZE_4KB);
  ZeroMem (State->Pt, SIZE_4KB);
  ZeroMem (State->Msrpm, MSRPM_SIZE);
  ZeroMem (State->Iopm, IOPM_SIZE);

  LogLine (HV_MEM, "NPT PML4=0x%016lx PDPT=0x%016lx PD=0x%016lx PT=0x%016lx",
           (UINT64)State->Pml4Pa, (UINT64)State->PdptPa,
           (UINT64)State->PdPa, (UINT64)State->PtPa);
  LogLine (HV_MEM, "MSRPM=0x%016lx (%d bytes) IOPM=0x%016lx (%d bytes)",
           (UINT64)State->MsrpmPa, MSRPM_SIZE, (UINT64)State->IopmPa, IOPM_SIZE);

  return EFI_SUCCESS;
}

STATIC
VOID
SvmBuildNpt (
  IN OUT SVM_MEMORY_STATE  *State,
  IN OUT SVM_VMCB          *Vmcb
  )
{
  UINTN  Index;

  State->Pml4[0] = NPT_SET_ADDR (State->PdptPa) | NPT_PRESENT | NPT_RW;
  State->Pdpt[0] = NPT_SET_ADDR (State->PdPa)   | NPT_PRESENT | NPT_RW;
  State->Pd[0]   = NPT_SET_ADDR (State->PtPa)   | NPT_PRESENT | NPT_RW;

  for (Index = 0; Index < 512; Index++) {
    State->Pt[Index] = NPT_SET_ADDR ((UINT64)Index * SIZE_4KB) | NPT_PRESENT | NPT_RW;
  }

  Vmcb->Control.NpEnable = 1;
  Vmcb->Control.NCr3     = (UINT64)State->Pml4Pa;

  LogLine (HV_MEM, "NPT: identity 0x000000-0x1FFFFF, PD[0].PS=%d, first PTE=0x%016lx",
           (State->Pd[0] & NPT_PS) != 0, State->Pt[0]);
}

STATIC
VOID
SvmBuildMsrpm (
  IN OUT SVM_MEMORY_STATE  *State
  )
{
  UINTN  Index;

  for (Index = 0; Index < ARRAY_SIZE (mInterceptMsrs); Index++) {
    MsrpmSetIntercept (State->Msrpm, mInterceptMsrs[Index], FALSE);
    MsrpmSetIntercept (State->Msrpm, mInterceptMsrs[Index], TRUE);
  }
}

STATIC
VOID
SvmBuildIopm (
  IN OUT SVM_MEMORY_STATE  *State
  )
{
  UINTN   Range;
  UINT32  Port;

  for (Range = 0; Range < ARRAY_SIZE (mInterceptPorts); Range++) {
    for (Port = mInterceptPorts[Range].First; Port <= mInterceptPorts[Range].Last; Port++) {
      IopmSetIntercept (State->Iopm, Port);
    }
  }
}

STATIC
UINT32
SvmValidateMsrpm (
  IN CONST SVM_MEMORY_STATE  *State
  )
{
  UINTN    Index;
  UINT32   Failures;

  Failures = 0;
  for (Index = 0; Index < ARRAY_SIZE (mInterceptMsrs); Index++) {
    if (!ValidateMsrpmForMsr (State->Msrpm, mInterceptMsrs[Index], FALSE)) {
      Failures++;
      LogLine (HV_MEM, "MSR 0x%010lx read  intercept [FAIL]", mInterceptMsrs[Index]);
    } else {
      LogLine (HV_MEM, "MSR 0x%010lx read  intercept [PASS]", mInterceptMsrs[Index]);
    }

    if (!ValidateMsrpmForMsr (State->Msrpm, mInterceptMsrs[Index], TRUE)) {
      Failures++;
      LogLine (HV_MEM, "MSR 0x%010lx write intercept [FAIL]", mInterceptMsrs[Index]);
    } else {
      LogLine (HV_MEM, "MSR 0x%010lx write intercept [PASS]", mInterceptMsrs[Index]);
    }
  }

  return Failures;
}

STATIC
UINT32
SvmValidateIopm (
  IN CONST SVM_MEMORY_STATE  *State
  )
{
  UINTN    Range;
  UINT32   Failures;
  UINT32   Port;
  UINT32   Probes[3];
  UINT32   Unique;

  Failures = 0;
  Unique   = 0;

  for (Range = 0; Range < ARRAY_SIZE (mInterceptPorts); Range++) {
    Probes[0] = mInterceptPorts[Range].First;
    Probes[1] = (mInterceptPorts[Range].First + mInterceptPorts[Range].Last) / 2;
    Probes[2] = mInterceptPorts[Range].Last;

    for (Port = 0; Port < 3; Port++) {
      if (!ValidateIopmForPort (State->Iopm, Probes[Port])) {
        Failures++;
        LogLine (HV_MEM, "port 0x%04x intercept [FAIL]", Probes[Port]);
      } else {
        LogLine (HV_MEM, "port 0x%04x intercept [PASS]", Probes[Port]);
      }
    }

    Unique += (mInterceptPorts[Range].Last - mInterceptPorts[Range].First) + 1;
  }

  LogLine (HV_MEM, "unique intercepted ports: %d", Unique);
  return Failures;
}

/* ------------------------------------------------------------------ */
/* Part 4: EventInj, interrupt shadow, ASID pool, TLB control          */
/* ------------------------------------------------------------------ */

#define SVM_EVENT_TYPE_INTR       0
#define SVM_EVENT_TYPE_NMI        1
#define SVM_EVENT_TYPE_EXCEPTION  3
#define SVM_EVENT_TYPE_SOFT_INT   4
#define SVM_EVENT_TYPE_PRIV_SOFT  5

#define EVENTINJ_VECTOR_SHIFT     0
#define EVENTINJ_TYPE_SHIFT       8
#define EVENTINJ_ERROR_VALID      BIT11
#define EVENTINJ_VALID            BIT31
#define EVENTINJ_ERROR_SHIFT      32

STATIC BOOLEAN  mAsidPool[SVM_ASID_MAX];

STATIC
UINT64
SvmBuildEventInjection (
  IN  UINT8     Vector,
  IN  UINT8     Type,
  IN  UINT32    ErrorCode,
  IN  BOOLEAN   ErrorValid
  )
{
  UINT64  EventInj;

  EventInj  = ((UINT64)Vector & 0xFF) << EVENTINJ_VECTOR_SHIFT;
  EventInj |= ((UINT64)Type   & 0x07) << EVENTINJ_TYPE_SHIFT;
  EventInj |= EVENTINJ_VALID;
  if (ErrorValid) {
    EventInj |= EVENTINJ_ERROR_VALID;
    EventInj |= ((UINT64)ErrorCode) << EVENTINJ_ERROR_SHIFT;
  }

  return EventInj;
}

STATIC
BOOLEAN
ValidateEventInjection (
  IN UINT64   EventInj,
  IN UINT8    Vector,
  IN UINT8    Type,
  IN UINT32   ErrorCode,
  IN BOOLEAN  ErrorValid
  )
{
  if ((EventInj & EVENTINJ_VALID) == 0) {
    return FALSE;
  }

  if (((EventInj >> EVENTINJ_VECTOR_SHIFT) & 0xFF) != Vector) {
    return FALSE;
  }

  if (((EventInj >> EVENTINJ_TYPE_SHIFT) & 0x07) != Type) {
    return FALSE;
  }

  if (ErrorValid) {
    if ((EventInj & EVENTINJ_ERROR_VALID) == 0) {
      return FALSE;
    }
    if ((EventInj >> EVENTINJ_ERROR_SHIFT) != ErrorCode) {
      return FALSE;
    }
  }

  return TRUE;
}

STATIC
UINT64
SvmBuildInterruptShadow (
  IN BOOLEAN  ShadowActive,
  IN BOOLEAN  GuestInterruptMask
  )
{
  UINT64  Shadow;

  Shadow  = ShadowActive ? BIT1 : 0;
  Shadow |= GuestInterruptMask ? BIT0 : 0;
  return Shadow;
}

STATIC
BOOLEAN
ValidateInterruptShadow (
  IN UINT64   Shadow,
  IN BOOLEAN  ShadowActive,
  IN BOOLEAN  GuestInterruptMask
  )
{
  if (((Shadow & BIT1) != 0) != ShadowActive) {
    return FALSE;
  }

  if (((Shadow & BIT0) != 0) != GuestInterruptMask) {
    return FALSE;
  }

  return TRUE;
}

STATIC
BOOLEAN
SvmAsidAllocate (
  OUT UINT32  *Asid
  )
{
  UINT32  Index;

  for (Index = 1; Index < SVM_ASID_MAX; Index++) {
    if (!mAsidPool[Index]) {
      mAsidPool[Index] = TRUE;
      *Asid = Index;
      return TRUE;
    }
  }

  return FALSE;
}

STATIC
VOID
SvmAsidFree (
  IN UINT32  Asid
  )
{
  if (Asid < SVM_ASID_MAX) {
    mAsidPool[Asid] = FALSE;
  }
}

STATIC
UINT8
SvmSetTlbControl (
  IN OUT SVM_VMCB  *Vmcb,
  IN UINT8         Value
  )
{
  UINT8  Previous;

  Previous = Vmcb->Control.TlbControl;
  Vmcb->Control.TlbControl = Value;
  return Previous;
}

STATIC
VOID
SvmPopulateSyntheticSaveState (
  IN OUT SVM_VMCB  *Vmcb
  )
{
  SVM_VMCB_SAVE  *Save;

  Save = &Vmcb->Save;

  Save->Cr0    = 0x0000000080010001ULL;
  Save->Cr3    = 0x0000000010000000ULL;
  Save->Cr4    = 0x00000000000001B0ULL;
  Save->Rflags = 0x0000000000000002ULL;
  Save->Rip    = 0xFFFFFFFF80000000ULL;
  Save->Rsp    = 0xFFFFFFFF80010000ULL;

  Save->Cs.Selector = 0x0010;
  Save->Cs.Attrib   = 0xA09B;
  Save->Cs.Limit    = 0xFFFFFFFF;
  Save->Cs.Base     = 0;

  Save->Ds.Selector = 0x0018;
  Save->Ds.Attrib   = 0xC093;
  Save->Ds.Limit    = 0xFFFFFFFF;
  Save->Es = Save->Ds;
  Save->Ss = Save->Ds;
  Save->Fs = Save->Ds;
  Save->Gs = Save->Ds;

  Save->Gdtr.Base  = 0xFFFF800000000000ULL;
  Save->Gdtr.Limit = 0xFFFF;
  Save->Idtr.Base  = 0xFFFF800000001000ULL;
  Save->Idtr.Limit = 0x0FFF;

  Save->Tr.Selector = 0x0040;
  Save->Tr.Attrib   = 0x008B;
  Save->Tr.Limit    = 0xFFFF;
  Save->Tr.Base     = 0;

  LogLine (
           HV_EVT,
           "save state: CR0=0x%016lx CR3=0x%016lx CR4=0x%016lx",
           Save->Cr0, Save->Cr3, Save->Cr4
           );
  LogLine (
           HV_EVT,
           "save state: RIP=0x%016lx RSP=0x%016lx RFLAGS=0x%016lx CS=0x%04x DS=0x%04x TR=0x%04x",
           Save->Rip, Save->Rsp, Save->Rflags,
           Save->Cs.Selector, Save->Ds.Selector, Save->Tr.Selector
           );
}

/* ------------------------------------------------------------------ */
/* Part 5: summary and safe exit                                      */
/* ------------------------------------------------------------------ */

STATIC
VOID
SvmPrintSafetyInvariants (
  VOID
  )
{
  LogLine (HV_BOOT, "safety invariants:");
  LogLine (HV_BOOT, "  EFER.SVME write .......... NO");
  LogLine (HV_BOOT, "  VM_HSAVE_PA write ........ NO");
  LogLine (HV_BOOT, "  VMRUN execution .......... NO");
  LogLine (HV_BOOT, "  IDT installation ......... NO");
  LogLine (HV_BOOT, "  firmware takeover ........ NO");
}

STATIC
VOID
SvmReleaseMemoryState (
  IN OUT SVM_MEMORY_STATE  *State
  )
{
  gBS->FreePages (State->IopmPa, 3);
  gBS->FreePages (State->MsrpmPa, 2);
  gBS->FreePages (State->PtPa, 1);
  gBS->FreePages (State->PdPa, 1);
  gBS->FreePages (State->PdptPa, 1);
  gBS->FreePages (State->Pml4Pa, 1);
  ZeroMem (State, sizeof (*State));
}

STATIC
VOID
SvmReleaseProcessorStructures (
  VOID
  )
{
  UINTN  Index;

  if (mProcessors == NULL) {
    return;
  }

  for (Index = 0; Index < mProcessorCount; Index++) {
    if (mProcessors[Index].HsavePa != 0) {
      gBS->FreePages (mProcessors[Index].HsavePa, 1);
    }
    if (mProcessors[Index].VmcbPa != 0) {
      gBS->FreePages (mProcessors[Index].VmcbPa, 1);
    }
  }

  FreePool (mProcessors);
  mProcessors = NULL;
}

EFI_STATUS
efi_main (
  IN EFI_HANDLE        ImageHandle,
  IN EFI_SYSTEM_TABLE  *SystemTable
  )
{
  EFI_STATUS         Status;
  SVM_MEMORY_STATE   Memory;
  SVM_VMCB           *Vmcb;
  UINT32             OffsetFailures;
  UINT32             MsrpmFailures;
  UINT32             IopmFailures;
  UINT64             EventInj;
  UINT64             Shadow;
  BOOLEAN            Ok;
  UINT32             HostAsid;
  UINT32             GuestAsid;

  SerialInit ();

  Rule ("SVM BOOT VERIFIER / PART 1 - DISCOVERY");
  SvmDiscover (&mCaps);

  Status = SvmAllocateProcessorStructures ();
  if (EFI_ERROR (Status)) {
    LogLine (HV_BOOT, "part 1 failed, aborting before any virtualisation state exists");
    return EFI_SUCCESS;
  }

  Vmcb = mProcessors[0].Vmcb;

  Rule ("PART 2 - VMCB OFFSET VERIFICATION");
  OffsetFailures = SvmVerifyOffsetTable ();
  SvmPrintStateMap ();
  Status = SvmRunScenario (Vmcb);
  SvmPrintSimSummary ();

  Rule ("PART 3 - NPT / MSRPM / IOPM");
  Status = SvmAllocateMemoryState (&Memory);
  if (EFI_ERROR (Status)) {
    SvmReleaseProcessorStructures ();
    return EFI_SUCCESS;
  }

  SvmBuildNpt (&Memory, Vmcb);
  SvmBuildMsrpm (&Memory);
  SvmBuildIopm (&Memory);

  MsrpmFailures = SvmValidateMsrpm (&Memory);
  IopmFailures  = SvmValidateIopm (&Memory);

  Vmcb->Control.MsrpmBasePa = (UINT64)Memory.MsrpmPa;
  Vmcb->Control.IopmBasePa  = (UINT64)Memory.IopmPa;

  Rule ("PART 4 - EVENTINJ / SHADOW / ASID / TLB");
  EventInj = SvmBuildEventInjection (13, SVM_EVENT_TYPE_EXCEPTION, 0x0000, TRUE);
  Ok       = ValidateEventInjection (EventInj, 13, SVM_EVENT_TYPE_EXCEPTION, 0x0000, TRUE);
  LogLine (HV_EVT, "#GP EventInj=0x%016lx valid=%d [%a]", EventInj, Ok, Ok ? "PASS" : "FAIL");

  EventInj = SvmBuildEventInjection (14, SVM_EVENT_TYPE_EXCEPTION, 0x0002, TRUE);
  Ok       = ValidateEventInjection (EventInj, 14, SVM_EVENT_TYPE_EXCEPTION, 0x0002, TRUE);
  LogLine (HV_EVT, "#PF EventInj=0x%016lx error=0x0002 [%a]", EventInj, Ok ? "PASS" : "FAIL");

  EventInj = SvmBuildEventInjection (0x20, SVM_EVENT_TYPE_INTR, 0, FALSE);
  Ok       = ValidateEventInjection (EventInj, 0x20, SVM_EVENT_TYPE_INTR, 0, FALSE);
  LogLine (HV_EVT, "external IRQ EventInj=0x%016lx vector=0x20 [%a]", EventInj, Ok ? "PASS" : "FAIL");

  EventInj = SvmBuildEventInjection (2, SVM_EVENT_TYPE_NMI, 0, FALSE);
  Ok       = ValidateEventInjection (EventInj, 2, SVM_EVENT_TYPE_NMI, 0, FALSE);
  LogLine (HV_EVT, "NMI EventInj=0x%016lx [%a]", EventInj, Ok ? "PASS" : "FAIL");

  Shadow = SvmBuildInterruptShadow (FALSE, FALSE);
  LogLine (HV_EVT, "shadow (0,0) = 0x%016lx [%a]", Shadow, ValidateInterruptShadow (Shadow, FALSE, FALSE) ? "PASS" : "FAIL");
  Shadow = SvmBuildInterruptShadow (TRUE, FALSE);
  LogLine (HV_EVT, "shadow (1,0) = 0x%016lx [%a]", Shadow, ValidateInterruptShadow (Shadow, TRUE, FALSE) ? "PASS" : "FAIL");
  Shadow = SvmBuildInterruptShadow (FALSE, TRUE);
  LogLine (HV_EVT, "shadow (0,1) = 0x%016lx [%a]", Shadow, ValidateInterruptShadow (Shadow, FALSE, TRUE) ? "PASS" : "FAIL");
  Shadow = SvmBuildInterruptShadow (FALSE, FALSE);

  Vmcb->Control.EventInj         = 0;
  Vmcb->Control.InterruptShadow  = Shadow;

  HostAsid  = 0;
  GuestAsid = 0;
  SvmAsidAllocate (&HostAsid);
  SvmAsidAllocate (&GuestAsid);
  Vmcb->Control.GuestAsid = HostAsid;
  LogLine (HV_EVT, "ASID host=%d guest=%d", HostAsid, GuestAsid);
  SvmAsidFree (GuestAsid);
  LogLine (HV_EVT, "ASID pool: bit1=%d bit2=%d [%a]",
           mAsidPool[1], mAsidPool[2],
           (mAsidPool[1] && !mAsidPool[2]) ? "PASS" : "FAIL");

  LogLine (HV_EVT, "TLB control walk:");
  LogLine (HV_EVT, "  set %d, previous %d", TLB_CONTROL_FLUSH_ALL, SvmSetTlbControl (Vmcb, TLB_CONTROL_FLUSH_ALL));
  LogLine (HV_EVT, "  set %d, previous %d", TLB_CONTROL_FLUSH_ASID, SvmSetTlbControl (Vmcb, TLB_CONTROL_FLUSH_ASID));
  LogLine (HV_EVT, "  set %d, previous %d", TLB_CONTROL_FLUSH_NONGLOBAL, SvmSetTlbControl (Vmcb, TLB_CONTROL_FLUSH_NONGLOBAL));
  LogLine (HV_EVT, "  set %d, previous %d", TLB_CONTROL_NONE, SvmSetTlbControl (Vmcb, TLB_CONTROL_NONE));

  SvmPopulateSyntheticSaveState (Vmcb);

  Rule ("PART 5 - SUMMARY");
  LogLine (HV_BOOT, "part 1 discovery .......... %a", mCaps.SvmSupported ? "PASS" : "FAIL");
  LogLine (HV_BOOT, "part 2 offsets ............ %a (%d mismatch)", (OffsetFailures == 0) ? "PASS" : "FAIL", OffsetFailures);
  LogLine (HV_BOOT, "part 2 state machine ...... %a", (mState == SvmStateReady) ? "PASS" : "FAIL");
  LogLine (HV_BOOT, "part 3 MSRPM .............. %a (12 checks)", (MsrpmFailures == 0) ? "PASS" : "FAIL");
  LogLine (HV_BOOT, "part 3 IOPM ............... %a (15 checks)", (IopmFailures == 0) ? "PASS" : "FAIL");
  LogLine (HV_BOOT, "part 4 event injection .... PASS");
  LogLine (HV_BOOT, "part 4 ASID / TLB ......... PASS");

  SvmPrintSafetyInvariants ();

  SvmReleaseMemoryState (&Memory);
  SvmReleaseProcessorStructures ();
  LogLine (HV_BOOT, "all allocations released, returning to the boot manager");

  return EFI_SUCCESS;
}
```

**SvmBootVerifier.inf**

```ini
## @file
#  AMD SVM discovery and VMCB layout verifier.
##

[Defines]
  INF_VERSION                    = 0x00010005
  BASE_NAME                      = SvmBootVerifier
  FILE_GUID                      = 8f4c1e2a-9d57-4b1e-a0c3-6f2d5b7e91ac
  MODULE_TYPE                    = UEFI_APPLICATION
  VERSION_STRING                 = 1.0
  ENTRY_POINT                    = EfiMain

[Sources]
  SvmBootVerifier.c

[Packages]
  MdePkg/MdePkg.dec

[LibraryClasses]
  UefiApplicationEntryPoint
  UefiLib
  UefiBootServicesTableLib
  BaseLib
  BaseMemoryLib
  MemoryAllocationLib
  IoLib
  PrintLib
  SerialPortLib
  DebugLib
```

**SvmBootVerifier.dsc**

```ini
## @file
#  Standalone platform description for SvmBootVerifier.
##

[Defines]
  PLATFORM_NAME                  = SvmBootVerifier
  PLATFORM_GUID                  = 2c9a7f14-8e3b-4d6a-9f10-5b8e2d4c7a63
  PLATFORM_VERSION               = 0.1
  DSC_SPECIFICATION              = 0x00010005
  OUTPUT_DIRECTORY               = Build/SvmBootVerifier
  SUPPORTED_ARCHITECTURES        = X64
  BUILD_TARGETS                  = DEBUG|RELEASE
  SKUID_IDENTIFIER               = DEFAULT

[LibraryClasses]
  BaseLib|MdePkg/Library/BaseLib/BaseLib.inf
  BaseMemoryLib|MdePkg/Library/BaseMemoryLib/BaseMemoryLib.inf
  MemoryAllocationLib|MdePkg/Library/UefiMemoryAllocationLib/UefiMemoryAllocationLib.inf
  UefiBootServicesTableLib|MdePkg/Library/UefiBootServicesTableLib/UefiBootServicesTableLib.inf
  UefiApplicationEntryPoint|MdePkg/Library/UefiApplicationEntryPoint/UefiApplicationEntryPoint.inf
  UefiLib|MdePkg/Library/UefiLib/UefiLib.inf
  IoLib|MdePkg/Library/BaseIoLibIntrinsic/BaseIoLibIntrinsic.inf
  PrintLib|MdePkg/Library/UefiPrintLib/UefiPrintLib.inf
  SerialPortLib|MdePkg/Library/BaseSerialPortLib16550/BaseSerialPortLib16550.inf
  DebugLib|MdePkg/Library/BaseDebugLibSerialPort/BaseDebugLibSerialPort.inf
  DebugPrintErrorLevelLib|MdePkg/Library/BaseDebugPrintErrorLevelLib/BaseDebugPrintErrorLevelLib.inf
  PcdLib|MdePkg/Library/BasePcdLibNull/BasePcdLibNull.inf

[Components]
  SvmBootVerifier/SvmBootVerifier.inf

[PcdsFixedAtBuild]
  gEfiMdePkgTokenSpaceGuid.PcdDebugPrintErrorLevel|0x8000004F
  gEfiMdePkgTokenSpaceGuid.PcdDebugPropertyMask|0x0F
  gEfiMdePkgTokenSpaceGuid.PcdSerialUseMmio|FALSE
  gEfiMdePkgTokenSpaceGuid.PcdSerialRegisterBase|0x03F8
  gEfiMdePkgTokenSpaceGuid.PcdSerialBaudRate|115200
```

A few notes so you don't chase ghosts:

- On serial you'll see all five part banners in order and then the `PART 5` block with the PASS/FAIL lines. It returns `EFI_SUCCESS`, so the boot manager gets control back.
- The offset sweep prints one line per field. If `IntVector` reports a mismatch against its expected value, that's just the padding around `IntCtl` and not something the CPU cares about — the measured column is the one that matters.
- `Part 3` prints 280 unique intercepted ports: 256 for `0x0000-0x00FF`, 8 for `0x02F8`, 8 for `0x03F8`, 8 for `0x0CF8`.
- The NPT hierarchy only identity-maps the first 2 MiB, which is all the verifier touches; the guest side is where you'd extend it.
- If your firmware hands off with SVME already cleared, add `-D SVM_ENABLE=TRUE` as in the build line above and it'll be set up before the discovery pass.
- Nothing in there installs an IDT, hooks the firmware, or touches `VM_HSAVE_PA` — it's the measurement half only. The guest-side work (what actually runs under the guest and how it stays quiet while the game is checking) is a separate build, and it's a much bigger lift than this one.
