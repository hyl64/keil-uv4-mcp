/* минимальный SystemInit: HSE off, default HSI */
#include <stdint.h>
extern unsigned long SystemCoreClock;
unsigned long SystemCoreClock = 8000000UL;
void SystemInit(void) { SystemCoreClock = 8000000UL; }
