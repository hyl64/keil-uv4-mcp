#include <stdint.h>
volatile uint32_t counter;
int main(void) { for(;;) { counter++; } }
