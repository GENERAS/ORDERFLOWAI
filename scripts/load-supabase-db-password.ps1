# Loads the OrderFlow AI Supabase database password from Windows Credential
# Manager into the current session as SUPABASE_DB_PASSWORD.
#
# The secret is never stored in this repository. Store it once with:
#   cmdkey /generic:OrderFlowAI:supabase-db /user:postgres /pass:<password>
#
# Usage:
#   . .\scripts\load-supabase-db-password.ps1
#   supabase db push --linked

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Stop'

$credentialReaderSource = @'
using System;
using System.Runtime.InteropServices;

public static class OrderFlowCredentialReader
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL
    {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credentialPtr);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern void CredFree(IntPtr cred);

    public static string ReadPassword(string target)
    {
        IntPtr credentialPtr;
        if (!CredRead(target, 1, 0, out credentialPtr))
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }

        try
        {
            CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(credentialPtr, typeof(CREDENTIAL));
            if (credential.CredentialBlobSize == 0)
            {
                return string.Empty;
            }

            return Marshal.PtrToStringUni(credential.CredentialBlob, (int)(credential.CredentialBlobSize / 2));
        }
        finally
        {
            CredFree(credentialPtr);
        }
    }
}
'@

if (-not ('OrderFlowCredentialReader' -as [type])) {
    Add-Type -TypeDefinition $credentialReaderSource
}

$password = [OrderFlowCredentialReader]::ReadPassword('OrderFlowAI:supabase-db')

if ([string]::IsNullOrWhiteSpace($password)) {
    throw 'Supabase database password was not found in Windows Credential Manager.'
}

$env:SUPABASE_DB_PASSWORD = $password
$ErrorActionPreference = $previousErrorActionPreference
Write-Output 'SUPABASE_DB_PASSWORD loaded for this session.'
