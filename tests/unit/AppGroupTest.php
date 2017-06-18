<?php


class AppGroupTest extends \Codeception\Test\Unit
{
    /**
     * @var \UnitTester
     */
    protected $tester;

    protected function _before()
    {
    }

    protected function _after()
    {
    }

    // tests
    public function testDeveSaberAQuantidadeDeGruposCriados()
    {

        $todos =  App\Group::all();
        $this->assertEquals(0 , $todos->count());

        $grupo =  new App\Group;
        $grupo->name = "grupo de teste";
        $grupo->save();
      //  print_r($grupo);

        $todos =  App\Group::all();
        //print_r($todos);//descomentar se precisar ver o log mais detalhado
        //die("//***************aqui em cima é log // ");

        $this->assertEquals(1 , $todos->count());

        $grupo =  new App\Group;
        $grupo->name = "grupo de teste 1";
        $grupo->save();

        $todos =  App\Group::all();
        //print_r($todos);//descomentar se precisar ver o log mais detalhado
        //die("//***************aqui em cima é log // ");

        $this->assertEquals(2 , $todos->count());

    }
}