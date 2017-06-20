<?php

require_once "Spyc.php";
$dados = Spyc::YAMLLoad('Store.yml');
//var_dump($dados);

foreach ($dados as $nome => $value) {
	$entidade = $nome;
	$campos ='';
	foreach ($value['fields'] as $k => $campo) {
		$nome_campo = $k;

		if($campo['schema'] == 'string'){	
			$campos .='<div class="form-group"><label class="col-sm-2 control-label">'.strtoupper($nome_campo).'</label>
	            <div class="col-sm-10"><input type="text" class="form-control" ng-model="loaded_entity.'.$nome_campo.'" name="'.$nome_campo.'"></div>
	        </div>
	        <div class="hr-line-dashed"></div>';
		}else{
			$campos .='<div class="form-group"><label class="col-sm-2 control-label">Normal</label>
	            <div class="col-sm-10"><input type="text" class="form-control"></div>
	        </div>
	        <div class="hr-line-dashed"></div>';
		}

	}
	file_put_contents('public/adm/views/models/'.strtolower($entidade).'.html', $campos);
	
}
