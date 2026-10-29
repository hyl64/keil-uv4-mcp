        PRESERVE8
        THUMB
        AREA    RESET, DATA, READONLY
        EXPORT  __Vectors
__Vectors
        DCD     0x20005000
        DCD     Reset_Handler
        AREA    |.text|, CODE, READONLY
        IMPORT  main
        EXPORT  Reset_Handler
Reset_Handler PROC
        b       main
        ENDP
        END

